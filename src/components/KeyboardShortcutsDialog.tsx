import { Dialog } from "./ui/Dialog";

type Shortcut = { keys: string[]; label: string };

const groups: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Navigering",
    shortcuts: [
      { keys: ["Ctrl", "1"], label: "Öppna översikt" },
      { keys: ["Ctrl", "2"], label: "Öppna bibliotek" },
      { keys: ["Ctrl", "3"], label: "Öppna Anki-kort" },
      { keys: ["Ctrl", ","], label: "Öppna inställningar" },
      { keys: ["Ctrl", "B"], label: "Visa eller dölj sidofält" },
      { keys: ["?"], label: "Visa dessa kortkommandon" },
    ],
  },
  {
    title: "Bibliotek",
    shortcuts: [
      { keys: ["Ctrl", "N"], label: "Skapa nästa objekt i strukturen" },
      {
        keys: ["Ctrl", "Shift", "N"],
        label: "Skapa föreläsning i vald modul",
      },
    ],
  },
  {
    title: "Föreläsning och ljud",
    shortcuts: [
      { keys: ["Mellanslag"], label: "Spela upp eller pausa ljud" },
      { keys: ["←", "→"], label: "Hoppa 10 sekunder" },
      { keys: ["Shift", "← / →"], label: "Hoppa 30 sekunder" },
      { keys: ["M"], label: "Markera viktigt ögonblick" },
      { keys: ["R"], label: "Starta eller stoppa inspelning" },
      { keys: ["P"], label: "Pausa eller fortsätt inspelning" },
      { keys: ["Shift", "I"], label: "Importera ljud" },
      { keys: ["Shift", "T"], label: "Öppna transkribering" },
      { keys: ["Ctrl", "F"], label: "Sök i transkript" },
      { keys: ["Ctrl", "Enter"], label: "Öppna kort för föreläsningen" },
    ],
  },
  {
    title: "PDF-slides",
    shortcuts: [
      { keys: ["Page Up", "["], label: "Föregående slide" },
      { keys: ["Page Down", "]"], label: "Nästa slide" },
      { keys: ["Home"], label: "Första slide" },
      { keys: ["End"], label: "Sista slide" },
    ],
  },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Kortkommandon"
      description="De fungerar när du inte skriver i ett textfält eller har en dialog öppen. På Mac används Cmd i stället för Ctrl."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 text-xs font-semibold text-[var(--palette-text)]">
              {group.title}
            </h3>
            <dl className="space-y-1.5">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={`${group.title}-${shortcut.label}`}
                  className="flex items-center justify-between gap-4 text-xs"
                >
                  <dt className="text-[var(--palette-text-muted)]">
                    {shortcut.label}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded-md border border-[var(--palette-border)] bg-[var(--palette-surface-muted)] px-1.5 py-0.5 font-sans text-[11px] font-medium text-[var(--palette-text-muted)]"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
