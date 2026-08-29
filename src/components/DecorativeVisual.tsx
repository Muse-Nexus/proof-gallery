type DecorativeVisualProps = {
  className?: string;
  kind: "ai" | "unsplash";
  src: string;
};

export function DecorativeVisual({
  className = "",
  kind,
  src,
}: DecorativeVisualProps) {
  const classes = ["decorative-visual", `decorative-visual--${kind}`, className]
    .filter(Boolean)
    .join(" ");
  const dimensions =
    kind === "ai"
      ? { height: 1024, width: 1536 }
      : { height: 1200, width: 900 };

  return (
    <figure className={classes}>
      <img
        src={src}
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchPriority={kind === "ai" ? "high" : "auto"}
        loading={kind === "ai" ? "eager" : "lazy"}
        referrerPolicy="no-referrer"
        {...dimensions}
      />
      <figcaption>
        {kind === "ai" ? (
          <span>AI-generated decorative image</span>
        ) : (
          <span>
            Decorative photo ·{" "}
            <a href="https://unsplash.com/@janlbhj" target="_blank" rel="noreferrer">
              Jan L.
            </a>{" "}
            /{" "}
            <a
              href="https://unsplash.com/photos/colorful-paper-cutouts-form-an-abstract-collage-rUJP-3aLpBE"
              target="_blank"
              rel="noreferrer"
            >
              Unsplash
            </a>
          </span>
        )}
        <strong>Not saved Proof</strong>
      </figcaption>
    </figure>
  );
}
