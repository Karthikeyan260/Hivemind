import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";

/** A canned HIVEMIND reply in the real wire format (newline-delimited JSON events). */
const REPLY = [
  { type: "meta", conversation_id: "e2e-conv", intent: "CHAT", sources: [] },
  { type: "delta", text: "Vanakkam! " },
  { type: "delta", text: "This is a test reply." },
  { type: "done", provider: "e2e", model: "stub", latency_ms: 5 },
]
  .map((e) => JSON.stringify(e))
  .join("\n");

async function unlock(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/unlock$/);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).not.toHaveURL(/\/unlock/, { timeout: 20_000 });
}

test.afterEach(async ({ page }) => {
  // End the session this test opened (the server stores sessions in the real project).
  await page.request.delete("/api/unlock").catch(() => {});
});

test("everything is locked without a session", async ({ page, request }) => {
  await page.goto("/notes");
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByRole("heading", { name: "HIVEMIND" })).toBeVisible();
  const api = await request.get("/api/notes");
  expect(api.status()).toBe(401);
  const model = await request.get("/wake/melspectrogram.onnx", { maxRedirects: 0 });
  expect(model.status()).toBe(307);
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/unlock");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText(/wrong|incorrect|too many/i)).toBeVisible();
  await expect(page).toHaveURL(/\/unlock$/);
});

test("unlock, chat, lock", async ({ page }) => {
  await page.route("**/api/hivemind", async (route) => {
    const body = route.request().postDataJSON() as { message?: string };
    expect(body.message).toBe("hello from the test");
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `${REPLY}\n` });
  });
  await unlock(page);

  const box = page.getByLabel("Message HIVEMIND");
  await expect(box).toBeEnabled();
  await box.fill("hello from the test");
  await box.press("Enter");
  await expect(page.getByText("hello from the test")).toBeVisible();
  await expect(page.getByText("Vanakkam! This is a test reply.")).toBeVisible();
  await expect(box).toBeEnabled(); // back to idle

  // Locking ends the session: the app is closed again.
  await page.request.delete("/api/unlock");
  await page.goto("/");
  await expect(page).toHaveURL(/\/unlock$/);
});
