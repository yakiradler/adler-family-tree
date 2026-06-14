/**
 * Imperative in-app dialogs — drop-in replacements for the browser's
 * window.confirm / window.alert that match the app's glass aesthetic and
 * stay localized/RTL, instead of the gray "localhost says…" OS popups that
 * read as broken/scammy to a non-technical family user.
 *
 * Usage:
 *   if (await confirmDialog({ message: t.someConfirm })) { ... }
 *   await alertDialog({ message: t.someInfo })
 *
 * A single <DialogHost/> mounted in App.tsx renders the current request.
 * One dialog at a time (matches native confirm/alert semantics).
 */
export interface DialogRequest {
  id: number
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive actions. */
  danger?: boolean
  mode: 'confirm' | 'alert'
}

type Internal = DialogRequest & { resolve: (v: boolean) => void }

let current: Internal | null = null
const listeners = new Set<() => void>()
let seq = 0
const emit = () => listeners.forEach((l) => l())

export function subscribeDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getDialog(): DialogRequest | null {
  return current
}

/** Ask the user to confirm. Resolves true (confirm) / false (cancel). */
export function confirmDialog(opts: Omit<DialogRequest, 'id' | 'mode'>): Promise<boolean> {
  return new Promise((resolve) => {
    current = { ...opts, id: ++seq, mode: 'confirm', resolve }
    emit()
  })
}

/** Show a one-button notice. Resolves when dismissed. */
export function alertDialog(
  opts: Omit<DialogRequest, 'id' | 'mode' | 'cancelLabel' | 'danger'>,
): Promise<void> {
  return new Promise((resolve) => {
    current = { ...opts, id: ++seq, mode: 'alert', resolve: () => resolve() }
    emit()
  })
}

/** Called by DialogHost when the user picks an option. */
export function closeDialog(result: boolean): void {
  const req = current
  current = null
  emit()
  req?.resolve(result)
}
