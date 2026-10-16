import { assert, it } from "@effect/vitest";

import {
  ANDROID_PREVIEW_SIGNER,
  androidVersionCode,
  apkSigningCertificate,
  nextAndroidPreviewCode,
  verifyAndroidPreview,
} from "./android-preview.ts";

it("allocates increasing codes across repeated builds and clock rollback", () => {
  const now = Date.UTC(2026, 9, 16, 12);
  const first = nextAndroidPreviewCode(1, now);
  const second = nextAndroidPreviewCode(first, now);
  assert.equal(second, first + 1);
  assert.equal(nextAndroidPreviewCode(second, now - 86_400_000), second + 1);
  assert.throws(() => nextAndroidPreviewCode(2_100_000_000, now));
  assert.throws(() => nextAndroidPreviewCode(Number.NaN, now));
});

it("rejects invalid version code overrides without changing normal app configuration", () => {
  assert.isUndefined(androidVersionCode(undefined));
  assert.equal(androidVersionCode("214000001"), 214000001);
  for (const value of ["0", "-1", "1.2", "1e3", "", "01", "2100000001"]) {
    assert.throws(() => androidVersionCode(value));
  }
});

it("verifies the package, native version and retained signing identity before delivery", () => {
  const valid = {
    badging:
      "package: name='com.t3tools.t3code.preview' versionCode='42' versionName='2.0.0-preview.42' platformBuildVersionName='17'\n",
    certificate: ANDROID_PREVIEW_SIGNER,
    versionCode: 42,
    versionName: "2.0.0-preview.42",
  };
  verifyAndroidPreview(valid);
  assert.throws(() => verifyAndroidPreview({ ...valid, versionCode: 43 }));
  assert.throws(() => verifyAndroidPreview({ ...valid, versionName: "other" }));
  assert.throws(() => verifyAndroidPreview({ ...valid, certificate: "0".repeat(64) }));
  assert.throws(() =>
    verifyAndroidPreview({ ...valid, badging: valid.badging.replace(".preview'", "'") }),
  );
  assert.throws(() => verifyAndroidPreview({ ...valid, badging: "" }));
});

it("requires a verified single signing certificate rather than accepting a different or missing signer", () => {
  const output = `Signer #1 certificate DN: CN=Android Debug\nSigner #1 certificate SHA-256 digest: ${ANDROID_PREVIEW_SIGNER}\n`;
  assert.equal(apkSigningCertificate(output), ANDROID_PREVIEW_SIGNER);
  const schemeOutput = `V2 Signer: certificate DN: CN=Android Debug\nV2 Signer: certificate SHA-256 digest: ${ANDROID_PREVIEW_SIGNER}\n`;
  assert.equal(apkSigningCertificate(schemeOutput), ANDROID_PREVIEW_SIGNER);
  assert.equal(
    apkSigningCertificate(schemeOutput + schemeOutput.replaceAll("V2 Signer", "V3 Signer")),
    ANDROID_PREVIEW_SIGNER,
  );
  assert.throws(() =>
    apkSigningCertificate(
      schemeOutput + `V3 Signer: certificate SHA-256 digest: ${"0".repeat(64)}\n`,
    ),
  );
  assert.throws(() => apkSigningCertificate("verification failed"));
  assert.throws(() =>
    apkSigningCertificate(output + `Signer #2 certificate SHA-256 digest: ${"0".repeat(64)}\n`),
  );
});
