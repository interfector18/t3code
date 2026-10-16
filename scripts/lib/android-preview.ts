export const ANDROID_PREVIEW_PACKAGE = "com.t3tools.t3code.preview";
export const ANDROID_PREVIEW_SIGNER =
  "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";

export function androidVersionCode(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/u.test(value) || Number(value) > 2_100_000_000) {
    throw new Error("T3CODE_ANDROID_VERSION_CODE must be an integer from 1 to 2100000000");
  }
  return Number(value);
}

export function nextAndroidPreviewCode(previous: number, now: number) {
  if (!Number.isSafeInteger(previous) || previous < 0)
    throw new Error("Invalid saved Android build counter");
  const next = Math.max(previous + 1, Math.floor((now - Date.UTC(2020, 0, 1)) / 1000));
  return androidVersionCode(String(next))!;
}

export function apkSigningCertificate(output: string) {
  // SDK 37 labels certificates by signature scheme instead of signer number.
  const certificates = new Set(
    [
      ...output.matchAll(
        /^(?:Signer #\d+|V\d+ Signer):? certificate SHA-256 digest: ([0-9a-f]{64})\s*$/gimu,
      ),
    ].map((match) => match[1]!.toLowerCase()),
  );
  if (certificates.size !== 1) {
    throw new Error("Expected exactly one APK signing certificate");
  }
  return [...certificates][0]!;
}

export function verifyAndroidPreview(input: {
  readonly badging: string;
  readonly certificate: string;
  readonly versionCode: number;
  readonly versionName: string;
}) {
  const match = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/mu.exec(
    input.badging,
  );
  if (
    match?.[1] !== ANDROID_PREVIEW_PACKAGE ||
    Number(match?.[2]) !== input.versionCode ||
    match?.[3] !== input.versionName
  )
    throw new Error("Built APK package/version does not match the requested preview");
  if (input.certificate !== ANDROID_PREVIEW_SIGNER) {
    throw new Error("APK signing identity changed; refusing to publish an incompatible update");
  }
}
