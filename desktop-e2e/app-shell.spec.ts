import { browser, expect } from "@wdio/globals";

describe("Lectio Windows desktop", () => {
  it("renders app shell and changes views in a real Tauri window", async () => {
    // tauri-driver starts sessions at about:blank; navigate to the packaged
    // webview origin before asserting the renderer.
    await browser.url("tauri://localhost");
    const shell = await browser.$("#root");
    await shell.waitForDisplayed();
    await (await browser.$("button=Översikt")).waitForDisplayed();

    await (await browser.$("button=Anki-kort")).click();
    await browser.waitUntil(
      async () => (await browser.getPageSource()).includes("Generera nya kort"),
      { timeout: 10_000, timeoutMsg: "Anki-vyn öppnades inte i Tauri-fönstret" },
    );

    await (await browser.$("button=Inställningar")).click();
    await browser.waitUntil(
      async () => (await browser.getPageSource()).includes("Inställningar"),
      { timeout: 10_000, timeoutMsg: "Inställningsvyn öppnades inte i Tauri-fönstret" },
    );
  });

  it("webview fyller klientytan efter resize", async () => {
    await browser.url("tauri://localhost");
    await browser.setWindowSize(1024, 720);
    const viewport = await browser.execute(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const root = await browser.$("#root");
    const rootSize = await root.getSize();
    expect(rootSize.width).toBeGreaterThanOrEqual(viewport.width - 2);
    expect(rootSize.height).toBeGreaterThanOrEqual(viewport.height - 2);
  });

  it("native titlebar controls are present and accessible", async () => {
    for (const label of ["Minimera", "Maximera eller återställ", "Stäng"]) {
      const control = await browser.$(`[aria-label="${label}"]`);
      await control.waitForDisplayed();
      expect(await control.isEnabled()).toBe(true);
    }
  });

  it("maximizes and restores through the native titlebar", async () => {
    const maximize = await browser.$('[aria-label="Maximera eller återställ"]');
    const before = await browser.getWindowSize();
    await maximize.click();
    await browser.pause(250);
    const maximized = await browser.getWindowSize();
    expect(maximized.width).toBeGreaterThanOrEqual(before.width);
    await maximize.click();
  });
});
