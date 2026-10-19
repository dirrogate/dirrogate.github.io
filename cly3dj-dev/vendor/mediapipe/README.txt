MediaPipe for the Dirrogram person cutout (CLAUDE.md #428).
- vision_bundle.mjs + wasm/: @mediapipe/tasks-vision 1.0.1 (Apache-2.0, Google), unmodified except the source-map line removed.
- selfie_segmentation.tflite: the model from @mediapipe/selfie_segmentation 0.1.1675465747 (Apache-2.0, Google) with TFLite
  metadata added (tflite-support 0.4.4 ImageSegmenter writer: input normalisation mean 0, std 255; one label, person),
  which the Tasks ImageSegmenter needs. Weights unchanged.
