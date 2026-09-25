import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { refreshTikTokToken } from "@/lib/agents/tiktokEcosystem";
import { refreshXToken } from "@/lib/agents/xEcosystem";

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface AccountTokens {
  id: string;
  platform: string;
  accessTokenEncrypted: string;
  tokenExpiresAt: Date | null;
  refreshTokenEncrypted: string | null;
}

// TikTok access tokens live 24h, X's 2h. When one is expired (or about to be)
// and we hold a refresh token, renew it and persist the new pair before publishing.
// X rotates its refresh token on every use, so the new one must always be saved.
// Throws with a readable message if it can't -- callers treat that as a clean,
// pre-network failure (nothing was sent to the platform).
export async function getUsableAccessToken(account: AccountTokens): Promise<string> {
  const expiring = account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  const platform = account.platform;
  if ((platform !== "TIKTOK" && platform !== "X") || !expiring) return decryptToken(account.accessTokenEncrypted);
  const label = platform === "X" ? "X" : "TikTok";

  if (!account.refreshTokenEncrypted) {
    throw new Error(`${label} access token has expired and no refresh token is stored. Reconnect ${label} from the dashboard.`);
  }
  const clientKey = platform === "X" ? process.env.X_CLIENT_ID : process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = platform === "X" ? process.env.X_CLIENT_SECRET : process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) throw new Error(`${label} app credentials are not configured.`);

  const refresh = decryptToken(account.refreshTokenEncrypted);
  const result = platform === "X"
    ? await refreshXToken(refresh, clientKey, clientSecret)
    : await refreshTikTokToken(refresh, clientKey, clientSecret);
  if (!result.ok || !result.accessToken) {
    throw new Error(`${label} token refresh failed: ${result.error ?? "unknown error"}. Reconnect ${label} from the dashboard.`);
  }

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessTokenEncrypted: encryptToken(result.accessToken),
      tokenExpiresAt: result.expiresInSeconds ? new Date(Date.now() + result.expiresInSeconds * 1000) : null,
      ...(result.refreshToken && {
        refreshTokenEncrypted: encryptToken(result.refreshToken),
        refreshTokenExpiresAt: "refreshExpiresInSeconds" in result && typeof result.refreshExpiresInSeconds === "number" ? new Date(Date.now() + result.refreshExpiresInSeconds * 1000) : null,
      }),
    },
  });
  return result.accessToken;
}
