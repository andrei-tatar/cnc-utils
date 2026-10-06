/**
 * Saves a shape as a file (the shapes list's export button). Provided by
 * `CamService` in the app config: the model editor doesn't import the
 * pipelines (or the worker) itself.
 */
export abstract class ShapeExporter {
  abstract exportShapeSvg(shapeId: string, name: string): Promise<void>;
}
