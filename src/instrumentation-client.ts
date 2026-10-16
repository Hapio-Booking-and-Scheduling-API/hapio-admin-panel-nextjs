// Runs in the browser before any other client code (Next.js instrumentation-client convention).
// Hapio Calendar's dates are Temporal objects; the polyfill leaves a native Temporal alone.
import "temporal-polyfill/global"
