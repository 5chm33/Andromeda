# Hugging Face Image Provider Migration Notes

## Evidence collected 2026-08-16

The legacy endpoint used by Andromeda (`https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell`) returned an HTTP 410 error stating that the requested model is deprecated and unsupported by provider `hf-inference`.

Hugging Face's current Inference Providers text-to-image documentation lists `stabilityai/stable-diffusion-3-medium-diffusers` as the `hf-inference` provider mapping and describes raw-byte image output for a POST request using a Bearer token.

A live, minimal 512x512 probe with the configured user token returned HTTP 200, `Content-Type: image/jpeg`, and a valid JPEG file from:

`https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-3-medium-diffusers`

The existing text-to-image payload contract (`inputs` plus `parameters` containing width, height, and `num_inference_steps`) was accepted by that endpoint.

## Sources

1. Hugging Face, "Text to Image" documentation: https://huggingface.co/docs/inference-providers/en/tasks/text-to-image
2. Hugging Face, "Inference Providers" documentation: https://huggingface.co/docs/inference-providers/en/index
3. Hugging Face, "Welcome to Inference Providers on the Hub": https://huggingface.co/blog/inference-providers

## Implementation decision

Andromeda defaults `HF_IMAGE_MODEL` to `stabilityai/stable-diffusion-3-medium-diffusers`. The model can be changed by setting `HF_IMAGE_MODEL` to another currently supported provider model without editing source code.

No API token values are recorded in this document.
