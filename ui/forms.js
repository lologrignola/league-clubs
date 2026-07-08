let formView = null
let formTitle = null
let formFields = null
let formError = null
let onSubmitCallback = null

const FORM_TEMPLATE = `
  <h3 class="pc-form-title"></h3>
  <div class="pc-form-fields"></div>
  <p class="pc-form-error pc-hidden"></p>
  <div class="pc-form-actions">
    <button type="button" class="pc-btn" data-action="form-cancel">Cancel</button>
    <button type="button" class="pc-btn" data-action="form-submit">Confirm</button>
  </div>
`

export function ensureFormView(panel) {
  if (!panel) panel = document.getElementById('pengu-clubs-panel')
  if (!panel) return false

  formView = panel.querySelector('.pc-form-view')
  if (!formView) {
    const main = panel.querySelector('.pc-main')
    if (!main) return false

    formView = document.createElement('div')
    formView.className = 'pc-form-view pc-hidden'
    formView.innerHTML = FORM_TEMPLATE

    const chat = main.querySelector('.pc-chat')
    if (chat) main.insertBefore(formView, chat)
    else main.appendChild(formView)
  }

  formTitle = formView.querySelector('.pc-form-title')
  formFields = formView.querySelector('.pc-form-fields')
  formError = formView.querySelector('.pc-form-error')
  return Boolean(formTitle && formFields && formError)
}

export function mountFormView(panel) {
  return ensureFormView(panel)
}

/**
 * @param {{ title: string, fields: Array<{ id: string, label: string, placeholder?: string, maxLength?: number }>, onSubmit: (values: Record<string, string>) => Promise<void> }} opts
 */
export function openForm(opts) {
  if (!ensureFormView()) {
    throw new Error('Form UI not ready — reload client')
  }

  onSubmitCallback = opts.onSubmit
  formTitle.textContent = opts.title
  formError.classList.add('pc-hidden')
  formError.textContent = ''

  const submitBtn = formView.querySelector('[data-action="form-submit"]')
  if (submitBtn) submitBtn.textContent = opts.submitLabel ?? 'Confirm'

  formFields.innerHTML = ''
  for (const field of opts.fields) {
    const row = document.createElement('label')
    row.className = 'pc-form-field'
    row.innerHTML = `
      <span class="pc-form-label">${field.label}</span>
      <input
        class="pc-input"
        name="${field.id}"
        placeholder="${field.placeholder ?? ''}"
        maxlength="${field.maxLength ?? 120}"
        autocomplete="off"
      />
    `
    formFields.appendChild(row)
  }

  formView.classList.remove('pc-hidden')
  formView.style.cssText = [
    'flex:1',
    'padding:16px',
    'overflow-y:auto',
    'display:block',
    'min-height:200px',
    'background:#010a13',
  ].join(';')

  formView.querySelector('input')?.focus()
}

export function closeForm() {
  if (formView) {
    formView.classList.add('pc-hidden')
    formView.style.display = 'none'
  }
  onSubmitCallback = null

  const panel = document.getElementById('pengu-clubs-panel')
  const chatOpen = panel?.querySelector('.pc-chat:not(.pc-hidden)')
  if (!chatOpen) {
    panel?.querySelector('.pc-empty')?.classList.remove('pc-hidden')
  }
}

export async function submitForm() {
  if (!onSubmitCallback || !formFields) return

  const values = {}
  for (const input of formFields.querySelectorAll('input')) {
    values[input.name] = input.value.trim()
  }

  formError.classList.add('pc-hidden')

  try {
    await onSubmitCallback(values)
    closeForm()
  } catch (err) {
    formError.textContent = err.message ?? String(err)
    formError.classList.remove('pc-hidden')
    formView?.scrollIntoView({ block: 'nearest' })
  }
}
