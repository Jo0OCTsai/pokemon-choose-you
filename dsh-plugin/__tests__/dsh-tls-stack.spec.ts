/**
 * dsh/tlsStack：TLS 栈功能性探测——dsh-ssh 流安全依赖 TLS 1.2 PSK 套件
 * （PSK-AES256-GCM-SHA384，compatibility.md A3）；Electron 内嵌 Node（BoringSSL）
 * 在 setCipherList 阶段即拒（NO_CIPHER_MATCH），系统 Node（OpenSSL）可用。
 * 判据 = 功能性探测（try/catch 建安全上下文），非环境/版本启发式。
 */
import { describe, expect, it } from "vitest";
import { PSK_PROBE_CIPHER, tlsPskAvailable } from "../src/host/dsh/tlsStack";
import { createSecureContext } from "node:tls";

describe("tlsPskAvailable（TLS 栈功能性探测）", () => {
  it("探测套件 = dsh-ssh stream-security 写死的 PSK 套件名", () => {
    expect(PSK_PROBE_CIPHER).toBe("PSK-AES256-GCM-SHA384");
  });

  it("系统 Node（OpenSSL）→ true（本机运行时即实测）", () => {
    expect(tlsPskAvailable()).toBe(true);
  });

  it("注入抛错工厂（模拟 BoringSSL 拒配）→ false", () => {
    expect(
      tlsPskAvailable(() => {
        throw new Error("error:100000b1:SSL routines:OPENSSL_internal:NO_CIPHER_MATCH");
      }),
    ).toBe(false);
  });

  it("真 createSecureContext 对非 PSK 套件可用（探测面不误伤）", () => {
    // 对照：OpenSSL 认识普通套件名——探测失败确因 PSK 族缺席，而非上下文创建本身不可用
    expect(() => createSecureContext({ ciphers: "ECDHE-RSA-AES128-GCM-SHA256" })).not.toThrow();
  });
});
