import { describe, it, expect, vi, beforeEach } from "vitest";

const accountUpdate = vi.fn(async () => undefined);
vi.mock("@/lib/db", () => ({ prisma: { socialAccount: { update: accountUpdate } } }));

const decryptToken = vi.fn((v: string) => `dec(${v})`);
const encryptToken = vi.fn((v: string) => `enc(${v})`);
vi.mock("@/lib/crypto", () => ({ decryptToken, encryptToken }));

const refreshTikTokToken = vi.fn();
vi.mock("@/lib/agents/tiktokEcosystem", () => ({ refreshTikTokToken }));
const refreshXToken = vi.fn();
vi.mock("@/lib/agents/xEcosystem", () => ({ refreshXToken }));

const { getUsableAccessToken } = await import("@/lib/orchestrator/tokens");

const HOUR = 3600_000;
const acct = (o: Record<string, unknown> = {}) => ({
  id: "a1", platform: "TIKTOK", accessTokenEncrypted: "AT", refreshTokenEncrypted: "RT",
  tokenExpiresAt: new Date(Date.now() + HOUR), ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TIKTOK_CLIENT_KEY = "k";
  process.env.TIKTOK_CLIENT_SECRET = "s";
  process.env.X_CLIENT_ID = "xk";
  process.env.X_CLIENT_SECRET = "xs";
});

describe("getUsableAccessToken", () => {
  it("returns the stored token untouched while it is still valid", async () => {
    expect(await getUsableAccessToken(acct())).toBe("dec(AT)");
    expect(refreshTikTokToken).not.toHaveBeenCalled();
  });

  it("refreshes an expired TikTok token and persists the new pair", async () => {
    refreshTikTokToken.mockResolvedValue({ ok: true, accessToken: "NEW", refreshToken: "NEWR", expiresInSeconds: 86400, refreshExpiresInSeconds: 31536000 });
    expect(await getUsableAccessToken(acct({ tokenExpiresAt: new Date(Date.now() - HOUR) }))).toBe("NEW");
    expect(refreshTikTokToken).toHaveBeenCalledWith("dec(RT)", "k", "s");
    expect(accountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accessTokenEncrypted: "enc(NEW)", refreshTokenEncrypted: "enc(NEWR)" }) })
    );
  });

  it("fails clearly when expired and there is no refresh token", async () => {
    await expect(getUsableAccessToken(acct({ tokenExpiresAt: new Date(Date.now() - HOUR), refreshTokenEncrypted: null }))).rejects.toThrow(/Reconnect TikTok/);
  });

  it("fails clearly when TikTok rejects the refresh", async () => {
    refreshTikTokToken.mockResolvedValue({ ok: false, error: "refresh token expired" });
    await expect(getUsableAccessToken(acct({ tokenExpiresAt: new Date(Date.now() - HOUR) }))).rejects.toThrow(/refresh failed.*refresh token expired/);
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("never refreshes non-TikTok accounts", async () => {
    expect(await getUsableAccessToken(acct({ platform: "INSTAGRAM", tokenExpiresAt: new Date(Date.now() - HOUR) }))).toBe("dec(AT)");
    expect(refreshTikTokToken).not.toHaveBeenCalled();
  });

  it("refreshes an expired X token with the X app credentials and saves the rotated refresh token", async () => {
    refreshXToken.mockResolvedValue({ ok: true, accessToken: "XNEW", refreshToken: "XR2", expiresInSeconds: 7200 });
    expect(await getUsableAccessToken(acct({ platform: "X", tokenExpiresAt: new Date(Date.now() - HOUR) }))).toBe("XNEW");
    expect(refreshXToken).toHaveBeenCalledWith("dec(RT)", "xk", "xs");
    expect(refreshTikTokToken).not.toHaveBeenCalled();
    expect(accountUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accessTokenEncrypted: "enc(XNEW)", refreshTokenEncrypted: "enc(XR2)" }) })
    );
  });
});
