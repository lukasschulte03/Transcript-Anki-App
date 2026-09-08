import { browser, expect } from "@wdio/globals";

describe("Lectio Windows desktop", () => {
  it("renders app shell and changes views in a real Tauri window", async () => {
    // The native driver already attaches to the app's main WebView2 surface.
    // Calling browser.url() here navigates away from it to about:blank on
    // Windows, which made the former regression suite test an empty page.
    const shell = await browser.$("#root");
    await shell.waitForDisplayed();
    await (await browser.$("button=Översikt")).waitForDisplayed();

    await (await browser.$("button=Anki-kort")).click();
    await browser.waitUntil(
      async () => {
        const source = await browser.getPageSource();
        return source.includes("Generera nya kort") || source.includes("Skapa en föreläsning först");
      },
      { timeout: 10_000, timeoutMsg: "Anki-vyn öppnades inte i Tauri-fönstret" },
    );

    await (await browser.$("button=Inställningar")).click();
    await browser.waitUntil(
      async () => (await browser.getPageSource()).includes("Inställningar"),
      { timeout: 10_000, timeoutMsg: "Inställningsvyn öppnades inte i Tauri-fönstret" },
    );
  });

  it("webview fyller klientytan efter resize", async () => {
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

  it("minimizes through the custom titlebar and can be restored", async () => {
    const minimize = await browser.$('[aria-label="Minimera"]');
    await minimize.click();
    await browser.waitUntil(
      async () =>
        browser.execute(async () => {
          // WebDriver executes in the already bundled WebView, where bare
          // package imports are unavailable. Invoke the same Tauri command
          // used by Window.isMinimized() directly through its native bridge.
          return window.__TAURI_INTERNALS__.invoke("plugin:window|is_minimized", {
            label: "main",
          }) as Promise<boolean>;
        }),
      { timeout: 5_000, timeoutMsg: "Minimera-knappen minimerade inte Tauri-fönstret" },
    );
    await browser.maximizeWindow();
    await (await browser.$("#root")).waitForDisplayed();
  });
});
