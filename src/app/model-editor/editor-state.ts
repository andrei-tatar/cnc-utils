/**
 * What the editor's fields can ask of the app, through Formly's
 * `options.formState`.
 */
export type EditorState = {
  /** Sizes the stock round every operation's cuts (when it's still on). */
  fitStock(): Promise<void>;
  /**
   * The rotary axis was turned from lying along `from` to `to`: asks
   * whether to turn the project with it (see `turnProject`).
   */
  turnProject(from: 'x' | 'y', to: 'x' | 'y'): Promise<void>;
};
