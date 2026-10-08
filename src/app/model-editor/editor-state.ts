/**
 * What the editor's fields can ask of the app, through Formly's
 * `options.formState`.
 */
export type EditorState = {
  /** Sizes the stock round every operation's cuts (when it's still on). */
  fitStock(): Promise<void>;
};
