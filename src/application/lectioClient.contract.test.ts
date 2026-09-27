import { describe, expect, it } from "vitest";
import type { LectioClient } from "./lectioClient";
import { createInMemoryLectioClient } from "./testing/inMemoryLectioClient";
import { lectioClient as realClient } from "../infrastructure/lectioClientAdapter";

function contract(name: string, createClient: () => LectioClient) {
  describe(`${name} LectioClient`, () => {
    it("publicerar bibliotek- och sessionsändringar genom kontraktet", () => {
      const client = createClient();
      const root = client.library.getSnapshot().nodes[0];
      const originalTitle = root.title;
      let libraryUpdates = 0;
      let sessionUpdates = 0;
      const stopLibrary = client.library.subscribe(() => {
        libraryUpdates += 1;
      });
      const stopSession = client.session.subscribe(() => {
        sessionUpdates += 1;
      });

      expect(
        client.library.updateNode(root.id, { title: "Kontraktstest" }).ok,
      ).toBe(true);
      expect(client.library.getSnapshot().nodes[0].title).toBe("Kontraktstest");
      expect(client.session.selectNode(root.id).ok).toBe(true);
      expect(client.session.setActiveView("workspace").ok).toBe(true);
      expect(libraryUpdates).toBeGreaterThan(0);
      expect(sessionUpdates).toBeGreaterThan(0);

      client.library.updateNode(root.id, { title: originalTitle });
      client.session.setActiveView("dashboard");
      stopLibrary();
      stopSession();
    });

    it("returnerar stabila felobjekt i stället för råa implementationfel", () => {
      const result = createClient().session.selectNode("saknas");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not-found");
        expect(result.error.messageKey).toBe("lectio.error.not-found");
        expect(result.error.message).not.toContain("Zustand");
      }
    });
  });
}

contract("in-memory", createInMemoryLectioClient);
contract("real adapter", () => realClient);

describe("in-memory vertical slice", () => {
  it("publicerar bakgrundsjobb och notiser utan UI-beroenden", () => {
    const client = createInMemoryLectioClient();
    const jobId = "notification-contract-job";
    let observedJobs = 0;
    const stopJobs = client.jobs.subscribe((jobs) => {
      observedJobs = jobs.length;
    });
    expect(
      client.jobs.upsert({
        id: jobId,
        kind: "vision",
        label: "OCR-test",
        phase: "analyzing",
        status: "active",
        current: 2,
        total: 5,
      }).ok,
    ).toBe(true);
    expect(client.jobs.getSnapshot()[0].current).toBe(2);
    expect(observedJobs).toBe(1);
    client.jobs.dismiss(jobId);
    stopJobs();

    let observedNotifications = 0;
    const stopNotifications = client.notifications.subscribe((notices) => {
      observedNotifications = notices.length;
    });
    const pushed = client.notifications.push({
      level: "error",
      title: "Testfel",
    });
    expect(pushed.ok).toBe(true);
    expect(observedNotifications).toBe(1);
    if (pushed.ok) client.notifications.dismiss(pushed.value);
    expect(client.notifications.getSnapshot()).toEqual([]);
    stopNotifications();
  });

  it("skapar kurs, modul och föreläsning utan frontendberoenden", () => {
    const client = createInMemoryLectioClient();
    const course = client.library.addNode("workspace", "course", "Medicin");
    expect(course.ok).toBe(true);
    if (!course.ok) return;
    const module = client.library.addNode(course.value, "module", "Kirurgi");
    expect(module.ok).toBe(true);
    if (!module.ok) return;
    const lecture = client.library.addNode(module.value, "lecture", "Akut buk");
    expect(lecture.ok).toBe(true);
    if (!lecture.ok) return;
    client.transcript.replace(lecture.value, [
      { start: 0, end: 5, text: "Ett testsegment" },
    ]);
    expect(client.library.getSnapshot().segments).toHaveLength(1);
  });

  it("importerar inkorgsljud genom samma kontrakt som frontend använder", async () => {
    const client = createInMemoryLectioClient();
    const course = client.library.addNode("workspace", "course", "Medicin");
    expect(course.ok).toBe(true);
    if (!course.ok) return;
    const module = client.library.addNode(course.value, "module", "Kirurgi");
    expect(module.ok).toBe(true);
    if (!module.ok) return;
    const lecture = client.library.addNode(module.value, "lecture", "Akut buk");
    expect(lecture.ok).toBe(true);
    if (!lecture.ok) return;

    const progress: number[] = [];
    const result = await client.inbox.import(
      [
        {
          id: "drive-audio-1",
          name: "Akut buk 1.m4a",
          mimeType: "audio/mp4",
          size: 1024,
        },
      ],
      lecture.value,
      ({ completed }) => progress.push(completed),
    );

    expect(result.ok).toBe(true);
    expect(progress).toEqual([1]);
    expect(
      client.library.getSnapshot().lectures[lecture.value].audioParts,
    ).toHaveLength(1);
  });

  it("kan ta bort en ljuddel utan att påverka övriga ljuddelar", async () => {
    const client = createInMemoryLectioClient();
    const lecture = client.library.addNode("workspace", "lecture", "Ljudtest");
    expect(lecture.ok).toBe(true);
    if (!lecture.ok) return;
    const first = await client.assets.importAudio(lecture.value, {
      name: "ett.webm",
      mimeType: "audio/webm",
      bytes: new ArrayBuffer(1),
    });
    const second = await client.assets.importAudio(lecture.value, {
      name: "två.webm",
      mimeType: "audio/webm",
      bytes: new ArrayBuffer(1),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok) return;
    expect(
      (await client.assets.removeAudio(lecture.value, first.value)).ok,
    ).toBe(true);
    expect(
      client.library
        .getSnapshot()
        .lectures[lecture.value].audioParts?.map((part) => part.name),
    ).toEqual(["två.webm"]);
  });

  it("indexerar och permanent tar bort en lokal slidebild", async () => {
    const client = createInMemoryLectioClient();
    const lecture = client.library.addNode("workspace", "lecture", "Bildtest");
    expect(lecture.ok).toBe(true);
    if (!lecture.ok) return;
    await client.assets.importSlides(lecture.value, {
      name: "slides.pdf",
      mimeType: "application/pdf",
      bytes: new ArrayBuffer(1),
    });
    expect((await client.visuals.indexLecture(lecture.value)).ok).toBe(true);
    const visual =
      client.library.getSnapshot().lectures[lecture.value].visualIndex?.[0];
    expect(visual).toBeDefined();
    if (!visual) return;
    expect((await client.visuals.remove(lecture.value, visual.id)).ok).toBe(
      true,
    );
    expect(
      client.library.getSnapshot().lectures[lecture.value].visualIndex,
    ).toEqual([]);
    expect(
      client.library.getSnapshot().lectures[lecture.value].deletedVisualIds,
    ).toContain(visual.id);
  });
});
