/** True when the focused control should keep ownership of ordinary keystrokes. */
export function isKeyboardShortcutBlocked(
  event: KeyboardEvent,
  allowEditableTarget = false,
): boolean {
  if (event.defaultPrevented || event.isComposing) return true;

  const target = event.target;
  if (
    !allowEditableTarget &&
    target instanceof Element &&
    target.closest(
      'input:not([type="range"]), textarea, select, [contenteditable="true"], [role="textbox"]',
    )
  ) {
    return true;
  }

  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
    ),
  );
}
