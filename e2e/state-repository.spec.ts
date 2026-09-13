import { expect, seedLibrary, test } from "./qa-fixtures";

const stabilityMode = process.env.VITE_STABILITY_TEST === "true";
const databaseName = "lectio-assets-stability";

async function repositoryRecord(page: import("@playwright/test").Page, store: string) {
  return page.evaluate(
    ({ databaseName, store }) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(store, "readonly");
          const get = transaction.objectStore(store).get(
            store === "libraryStates"
              ? "lectio-state-v1"
              : "lectio-state-v1:legacy-local-storage",
          );
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result ?? null);
          transaction.oncomplete = () => database.close();
        };
      }),
    { databaseName, store },
  );
}

test("migrerar biblioteket idempotent till repository och återhämtar localStorage", async ({
  page,
}) => {
  test.skip(!stabilityMode, "Körs endast av qa:stability.");
  await page.goto("/");
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
    databaseName,
  );
  await seedLibrary(page);
  await page.reload();

  await expect
    .poll(() => repositoryRecord(page, "libraryStates"), { timeout: 10_000 })
    .not.toBeNull();
  await expect
    .poll(() => repositoryRecord(page, "stateMigrationBackups"))
    .not.toBeNull();

  const mirrored = await repositoryRecord(page, "libraryStates");
  await page.evaluate(() => localStorage.removeItem("lectio-state-v1"));
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("lectio-state-v1") ?? "{}").state?.nodes?.some(
          (node: { id: string }) => node.id === "lecture",
        ),
      ),
    )
    .toBe(true);
  expect(await repositoryRecord(page, "libraryStates")).toEqual(mirrored);

  await page.evaluate(() =>
    localStorage.setItem("lectio-state-v1", "{damaged-json"),
  );
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => {
        try {
          return JSON.parse(
            localStorage.getItem("lectio-state-v1") ?? "{}",
          ).state?.nodes?.some(
            (node: { id: string }) => node.id === "lecture",
          );
        } catch {
          // Hydration intentionally observes the corrupt value before the
          // asynchronous Dexie recovery restores the rollback copy.
          return false;
        }
      }),
    )
    .toBe(true);
});
