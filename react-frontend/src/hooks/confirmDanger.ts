import { confirmDialog } from 'primereact/confirmdialog'

/**
 * A destructive confirmation (PrimeVue's confirm.require with a danger accept button),
 * shown by the app's single <ConfirmDialog> (App.tsx).
 */
export function confirmDanger(options: { header: string; message: string; acceptLabel: string; rejectLabel: string; accept: () => void | Promise<void> }): void {
  confirmDialog({
    header: options.header,
    message: options.message,
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: options.acceptLabel,
    rejectLabel: options.rejectLabel,
    acceptClassName: 'p-button-danger',
    rejectClassName: 'p-button-text',
    defaultFocus: 'reject',
    accept: () => void options.accept()
  })
}
