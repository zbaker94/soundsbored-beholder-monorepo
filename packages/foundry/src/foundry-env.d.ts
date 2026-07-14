// Minimal ambient declarations for the Foundry v13 client globals this module
// uses. Not exhaustive — just enough for `tsc --noEmit` to pass on the glue.
export {};

declare global {
  const game: {
    settings: {
      register(namespace: string, key: string, data: Record<string, unknown>): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    user?: { isGM: boolean };
  };

  const ui: {
    notifications?: {
      info(msg: string): void;
      warn(msg: string): void;
      error(msg: string): void;
    };
  };

  const Hooks: {
    once(hook: string, fn: (...args: any[]) => void): number;
    on(hook: string, fn: (...args: any[]) => void): number;
  };

  // ApplicationV2 lives under the `foundry.applications.api` namespace in v13.
  // Typed loosely: the base class and mixin are treated as `any`-ish so a thin
  // subclass compiles without vendoring the full type surface.
  const foundry: {
    applications: {
      api: {
        ApplicationV2: FoundryApplicationV2Ctor;
        HandlebarsApplicationMixin: <T extends FoundryApplicationV2Ctor>(base: T) => T;
      };
    };
  };

  interface FoundryApplicationV2Instance {
    render(force?: boolean): Promise<unknown> | unknown;
    close(): Promise<unknown> | unknown;
    readonly element: HTMLElement;
    _prepareContext(options?: any): Promise<any>;
    _onRender(context?: any, options?: any): void;
  }
  interface FoundryApplicationV2Ctor {
    new (...args: any[]): FoundryApplicationV2Instance;
    DEFAULT_OPTIONS: Record<string, any>;
    PARTS: Record<string, any>;
  }
}
