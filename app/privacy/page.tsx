export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 leading-relaxed text-slate-700">
      <h1 className="text-2xl font-semibold text-slate-900">Privacy Policy</h1>
      <p className="mt-4">SB AI Systems Social Agents is an internal tool operated by SB AI Systems UK Ltd.</p>
      <p className="mt-4">
        This application stores only what it needs to operate: encrypted OAuth access tokens for
        connected Instagram/TikTok accounts, drafted post content, and compliance check results.
        Tokens are encrypted at rest (AES-256-GCM) and are never displayed or shared. No data
        collected here is sold or shared with third parties, and no data is collected from end
        users of Instagram or TikTok themselves -- only from the connected SB AI Systems business
        accounts and the authorized admin using this dashboard.
      </p>
      <p className="mt-4">
        For questions or a data deletion request, contact{" "}
        <a href="mailto:info@sbaisystems.co.uk" className="text-indigo-600 hover:underline">
          info@sbaisystems.co.uk
        </a>
        .
      </p>
    </main>
  );
}
