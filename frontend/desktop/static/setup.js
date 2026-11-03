// First-run screen: send the organisation address to the main process, which validates it.
const form = document.getElementById('form');
const input = document.getElementById('address');
const error = document.getElementById('error');
const submit = document.getElementById('submit');
window.qsvcDesktop.getWorkspace().then(current => { if (current) input.value = current; input.focus(); });
form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true; submit.textContent = 'Checking…';
    const result = await window.qsvcDesktop.setWorkspace(input.value.trim());
    if (!result.ok) { error.textContent = result.error; submit.disabled = false; submit.textContent = 'Connect'; input.focus(); }
});
