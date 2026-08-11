declare module '@demo/ui/shared/chip.module.less' {
  const classes: { readonly chip: string };
  export default classes;
}

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.module.less' {
  const classes: Record<string, string>;
  export default classes;
}
