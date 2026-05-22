export function parseModuleId(moduleId: string) {
  let name = '';
  let path = '';
  let version = '';
  let buf = '';
  let slash = 0;
  let isScope = false;

  const set = (type: string) => {
    if (type === 'path') path = buf;
    if (type === 'name') name = buf;
    if (type === 'version') version = buf;
    buf = '';
  };

  const setValueBySlash = (char: string) => {
    if (!name) {
      set('name');
    } else if (!version) {
      set('version');
    } else {
      buf += char;
    }
  };

  for (let i = 0, l = moduleId.length; i < l; i++) {
    const char = moduleId[i];
    if (char === '@') {
      if (i === 0) {
        buf += char;
        isScope = true;
      } else if (!name) {
        if (isScope) {
          if (slash === 1 && buf[buf.length - 1] !== '/') {
            set('name');
          } else {
            buf += char;
          }
        } else {
          set('name');
        }
      } else {
        buf += char;
      }
    } else if (char === '/') {
      if (slash === 0) {
        if (!isScope) {
          setValueBySlash(char);
        }
        buf += char;
      } else if (slash === 1) {
        if (isScope) {
          setValueBySlash(char);
        }
        buf += char;
      } else {
        buf += char;
      }
      slash++;
    } else {
      buf += char;
    }
  }

  if (!name) {
    set('name');
  } else if (!version) {
    moduleId[name.length] === '@' ? set('version') : set('path');
  } else if (!path) {
    set('path');
  }

  if (path) {
    path = `.${path}`;
  }

  // `@vue` -> ''
  // `@vue/` -> ''
  // `@vue//` -> ''
  if (isScope && (slash === 0 || name[name.length - 1] === '/')) {
    name = '';
    path = '';
    version = '';
  }

  return {
    name,
    path,
    version,
    raw: moduleId,
  };
}
