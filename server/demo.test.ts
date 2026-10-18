import { describe, expect, it } from "vitest";
import { demo, githubRepoUrl } from "./demo";

describe("demo API gate", () => {
  it("closes every data route unless DEMO_MODE is exactly true", async () => {
    const env = { DEMO_MODE: "false" };
    expect((await demo.request("http://localhost/api/demo/status", {}, env)).status).toBe(200);
    expect(await (await demo.request("http://localhost/api/demo/status", {}, env)).json()).toMatchObject({ data: { enabled: false, githubUrl: null } });
    expect((await demo.request("http://localhost/api/demo/overview", {}, env)).status).toBe(404);
    expect((await demo.request("http://localhost/api/demo/settings/api-key", { method: "PUT" }, env)).status).toBe(404);
    const open = { DEMO_MODE: "true" };
    expect((await demo.request("http://localhost/api/demo/overview", {}, open)).status).toBe(200);
    expect((await demo.request("http://localhost/api/demo/shipments/demo_shp_01/hiobuy-pay", { method: "POST" }, open)).status).toBe(403);
    expect((await demo.request("http://localhost/api/demo/settings/api-key", { method: "PUT", body: "{}" }, open)).status).toBe(403);
    expect((await demo.request("http://localhost/api/demo/users/demo_user_01/wallet", { method: "POST", body: "{}" }, open)).status).toBe(403);
    const body = (await (await demo.request("http://localhost/api/demo/overview", {}, open)).json()) as { data: { users: { total: number } } };
    expect(body.data.users.total).toBe(20);
  });

  it("uses the HioBuy forwarding repository unless a valid override is set", () => {
    expect(githubRepoUrl({})).toBe("https://github.com/hiobuy/forwarding");
    expect(githubRepoUrl({ GITHUB_REPO_URL: "https://github.com/hiobuy/forwarding/" })).toBe("https://github.com/hiobuy/forwarding");
    expect(githubRepoUrl({ GITHUB_REPO_URL: "https://example.com/repo" })).toBeNull();
  });
});
