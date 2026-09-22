export default function Privacy() {
  return (
    <main style={{ padding: 40, maxWidth: 720, margin: "0 auto", lineHeight: 1.6 }}>
      <h1>Privacy Policy</h1>
      <p>SB AI Systems Social Agents is an internal tool operated by SB AI Systems UK Ltd.</p>
      <p>
        This application stores only what it needs to operate: encrypted OAuth access tokens for
        connected Instagram/TikTok accounts, drafted post content, and compliance check results.
        Tokens are encrypted at rest (AES-256-GCM) and are never displayed or shared. No data
        collected here is sold or shared with third parties, and no data is collected from end
        users of Instagram or TikTok themselves -- only from the connected SB AI Systems business
        accounts and the authorized admin using this dashboard.
      </p>
      <p>
        For questions or a data deletion request, contact{" "}
        <a href="mailto:info@sbaisystems.co.uk">info@sbaisystems.co.uk</a>.
      </p>
    </main>
  );
}
