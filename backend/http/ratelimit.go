package http

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// ipLimiter holds a rate limiter per IP address.
type ipLimiter struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

type rateLimitStore struct {
	mu       sync.Mutex
	limiters map[string]*ipLimiter
}

var loginRateLimiter = &rateLimitStore{
	limiters: make(map[string]*ipLimiter),
}

// shareRateLimiter limits public share access attempts to 30 per minute per IP.
// This prevents brute-forcing share passwords while allowing legitimate bulk access.
var shareRateLimiter = &rateLimitStore{
	limiters: make(map[string]*ipLimiter),
}

func init() {
	// Periodically clean up stale entries every 5 minutes
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			loginRateLimiter.cleanup()
			shareRateLimiter.cleanup()
		}
	}()
}

func (s *rateLimitStore) get(ip string) *rate.Limiter {
	return s.getWithRate(ip, rate.Every(time.Minute/5), 5)
}

func (s *rateLimitStore) getWithRate(ip string, r rate.Limit, burst int) *rate.Limiter {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.limiters[ip]
	if !ok {
		entry = &ipLimiter{limiter: rate.NewLimiter(r, burst)}
		s.limiters[ip] = entry
	}
	entry.lastSeen = time.Now()
	return entry.limiter
}

func (s *rateLimitStore) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := time.Now().Add(-10 * time.Minute)
	for ip, entry := range s.limiters {
		if entry.lastSeen.Before(cutoff) {
			delete(s.limiters, ip)
		}
	}
}

// trustedProxyNets holds the networks that net.IP's own helpers do not cover.
//
// RFC-6598 (100.64.0.0/10, "carrier-grade NAT") is the one that matters here.
// Azure Container Apps — like most Kubernetes-derived platforms — addresses the
// pod network from that range, so the ingress reaches this container from a
// 100.x.x.x peer. It is not a public address and not a client we are talking to;
// it is our own front door.
var trustedProxyNets = func() []*net.IPNet {
	var nets []*net.IPNet
	for _, s := range []string{
		"100.64.0.0/10", // RFC-6598 CGNAT — Azure Container Apps / Kubernetes pod network
	} {
		if _, n, err := net.ParseCIDR(s); err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}()

// isPrivateIP reports whether the immediate peer is an address we treat as a
// trusted proxy — loopback, RFC-1918, RFC-4193 unique-local, link-local, or
// RFC-6598 carrier-grade NAT. Only requests from these addresses are permitted
// to set X-Forwarded-For / X-Real-Ip / X-Forwarded-Proto.
//
// This used to be a list of string prefixes and did not include 100.64.0.0/10,
// which is the range Container Apps actually uses. The consequences were all
// silent, and all in production:
//
//   - getScheme() never trusted X-Forwarded-Proto. TLS terminates at the
//     ingress, so r.TLS is nil and it reported "http". Drive built its B2C
//     redirect_uri as http://<host>/api/auth/chainfs/callback and Azure AD B2C
//     rejected every sign-in with AADB2C90006, since only the https form is
//     registered. B2C was right; the scheme was wrong.
//   - Every cookie whose Secure flag comes from getScheme() was written without
//     it — including chainfs_state_nonce and chainfs_pkce_verifier, the two that
//     hold a sign-in together.
//   - Strict-Transport-Security was gated the same way and never sent.
//   - realIP() fell through to the proxy's own address, so login rate limiting
//     was a single bucket shared by everyone using Drive instead of one bucket
//     per client. Five attempts between all of them.
//
// Parsing the address rather than matching text also handles IPv4-mapped IPv6
// (::ffff:10.0.0.1), which no "10." prefix could ever match.
//
// Broadening the trusted set does mean a client able to reach the container
// directly from a 100.x address could set these headers. Container Apps admits
// no such path — the container is reachable only through the ingress — so the
// exposure is the platform's isolation, not this list.
func isPrivateIP(ip string) bool {
	// Callers strip the port with LastIndex(":"), which leaves the brackets on an
	// IPv6 literal. Tolerate that here rather than requiring every caller to change.
	ip = strings.Trim(ip, "[]")

	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	if parsed.IsLoopback() || parsed.IsLinkLocalUnicast() || parsed.IsPrivate() {
		return true
	}
	for _, n := range trustedProxyNets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

// realIP extracts the real client IP, respecting X-Forwarded-For only when
// the immediate peer (RemoteAddr) is a trusted private/proxy address.
func realIP(r *http.Request) string {
	// Strip port from RemoteAddr to get the peer IP
	remoteIP := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remoteIP); err == nil {
		remoteIP = host
	} else if idx := strings.LastIndex(remoteIP, ":"); idx != -1 {
		remoteIP = remoteIP[:idx]
	}

	// Only trust forwarded headers when the request comes from a private address
	if isPrivateIP(remoteIP) {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			// Take the rightmost entry — the one appended by the trusted proxy. The leftmost
			// entries are client-supplied and spoofable, which would let an attacker rotate
			// the rate-limit key by sending a unique X-Forwarded-For per request.
			parts := strings.Split(fwd, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
		if fwd := r.Header.Get("X-Real-Ip"); fwd != "" {
			return strings.TrimSpace(fwd)
		}
	}

	return remoteIP
}

// withLoginRateLimit wraps a handleFunc with per-IP rate limiting.
// Returns 429 Too Many Requests when the limit is exceeded.
func withLoginRateLimit(fn handleFunc) handleFunc {
	return func(w http.ResponseWriter, r *http.Request, data *requestContext) (int, error) {
		ip := realIP(r)
		limiter := loginRateLimiter.get(ip)
		if !limiter.Allow() {
			w.Header().Set("Retry-After", "60")
			return http.StatusTooManyRequests, errTooManyRequests
		}
		return fn(w, r, data)
	}
}

// withShareRateLimit wraps a handleFunc with per-IP rate limiting for public share endpoints.
// Allows 30 requests per minute with a burst of 10 to cover normal browsing of a share,
// while preventing automated password brute-forcing.
func withShareRateLimit(fn handleFunc) handleFunc {
	return func(w http.ResponseWriter, r *http.Request, data *requestContext) (int, error) {
		ip := realIP(r)
		limiter := shareRateLimiter.getWithRate(ip, rate.Every(time.Minute/30), 10)
		if !limiter.Allow() {
			w.Header().Set("Retry-After", "60")
			return http.StatusTooManyRequests, errTooManyRequests
		}
		return fn(w, r, data)
	}
}

var errTooManyRequests = &rateLimitError{}

type rateLimitError struct{}

func (e *rateLimitError) Error() string {
	return "too many login attempts, please try again later"
}
