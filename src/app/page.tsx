export default function Home() {
  return (
    <main className="flex min-h-screen bg-neutral-950 text-neutral-100">
      <section className="mx-auto flex w-full max-w-6xl flex-col justify-between gap-12 px-6 py-16 md:px-10 lg:flex-row lg:gap-16 lg:py-24">
        <div className="max-w-2xl space-y-8">
          <div className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-300">
            Backend Runtime Active
          </div>

          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-neutral-400">
              Order Management Backend
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
              Production API surface for orders, payments, auth, and seller operations.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-neutral-300">
              This deployment serves the backend runtime. The root page is informational; operational checks
              should target the API routes directly.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex items-center justify-center rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-300"
              href="/api/health"
            >
              Open Health Check
            </a>
            <a
              className="inline-flex items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/5"
              href="/api/auth/login"
            >
              Auth Endpoint
            </a>
          </div>
        </div>

        <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white">Operational checks</p>
            <p className="mt-2 text-sm leading-7 text-neutral-300">
              Use <code className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-300">/api/health</code> to
              verify runtime and database connectivity.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white">Authentication</p>
            <p className="mt-2 text-sm leading-7 text-neutral-300">
              Seller authentication is exposed through <code className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-300">/api/auth/login</code>.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white">Public API</p>
            <p className="mt-2 text-sm leading-7 text-neutral-300">
              Public product and order creation routes are available under <code className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-300">/api/public/[sellerSlug]</code>.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-sm font-semibold text-white">Seller API</p>
            <p className="mt-2 text-sm leading-7 text-neutral-300">
              Seller order management and payment actions are available under <code className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-300">/api/seller</code>.
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
