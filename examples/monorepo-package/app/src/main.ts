import chipStyles from '@demo/ui/shared/chip.module.less';
import '@demo/ui/shared/helpers.css';
import './tokens-demo.less';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <h1>shared.output workspace HMR</h1>
    <p>Edit files under <code>packages/ui/src/shared/</code> — no <code>@demo/ui</code> rebuild needed.</p>
    <ul>
      <li><code>chip.module.less</code> → Modules (JS locals + scoped CSS)</li>
      <li><code>helpers.css</code> → plain CSS import</li>
      <li><code>tokens.less</code> → Less <code>@import (reference)</code> via <code>app/src/tokens-demo.less</code></li>
    </ul>
    <p>
      <span class="${chipStyles.chip}">shared chip</span>
      <span class="helper-reset">plain helpers.css</span>
      <span class="token-demo">tokens.less reference</span>
    </p>
    <pre id="locals"></pre>
  `;
  const locals = document.querySelector('#locals');
  if (locals) {
    locals.textContent = `chip class: ${chipStyles.chip}`;
  }
}
