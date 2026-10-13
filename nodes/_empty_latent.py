"""The empty LATENT that Sizes Pixaroma and Resolution Pixaroma hand out.

It is ComfyUI's own Empty Latent Image at the chosen size, batch 1, so wiring it
is exactly the same as wiring width and height into that node. Core's samplers
(KSampler, SamplerCustomAdvanced) adapt an empty latent to the model before the
noise is made (comfy.sample.fix_empty_latent_channels), so the same output works
for SD 1.5, SDXL, SD3, Flux, Flux 2, Qwen Image and the other image models.
"""


def empty_latent(width, height):
    w, h = int(width), int(height)
    try:
        # ComfyUI's top-level nodes.py (already loaded before any custom node),
        # NOT this pack's nodes/ folder, which is only ever imported relatively.
        # Calling core's node keeps the result identical on every ComfyUI
        # version, including the downscale key the samplers read.
        import nodes as core_nodes
        return core_nodes.EmptyLatentImage().generate(w, h, 1)[0]
    except Exception:
        import torch
        import comfy.model_management as mm
        kw = {"device": mm.intermediate_device()}
        if hasattr(mm, "intermediate_dtype"):
            kw["dtype"] = mm.intermediate_dtype()
        return {"samples": torch.zeros([1, 4, h // 8, w // 8], **kw), "downscale_ratio_spacial": 8}
