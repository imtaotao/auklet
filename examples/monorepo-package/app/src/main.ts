import chipStyles from '@demo/ui/shared/chip.module.less';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <p>Edit <code>packages/ui/src/shared/chip.module.less</code> to verify workspace shared.output HMR.</p>
    <span class="${chipStyles.chip}">shared chip</span>
    <pre id="locals"></pre>
  `;
  const locals = document.querySelector('#locals');
  if (locals) {
    locals.textContent = `chip class: ${chipStyles.chip}`;
  }
}
