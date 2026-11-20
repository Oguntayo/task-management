export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <section className="relative hidden flex-col justify-between bg-[#0c1f1d] p-12 text-white lg:flex">
        <p className="text-[15px] font-semibold tracking-tight">Workline</p>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Know what everyone committed to, what got done, and why things moved.</p>
          <p className="mt-4 text-sm leading-relaxed text-white/60">Planned work, urgent interruptions and product progress in one honest record, built for teams without a dedicated project manager.</p>
        </div>
        <p className="text-xs text-white/40">Every deadline change and approval is kept on the record.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12"><div className="w-full max-w-sm">{children}</div></section>
    </main>);
}
