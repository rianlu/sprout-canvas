interface Props {
  src: string;
  alt: string;
  /** Extra classes for the full image, such as a hover zoom. */
  className?: string;
}

/**
 * Fills a fixed-ratio, `relative overflow-hidden` frame without cropping or enlarging the example:
 * the whole image sits centered at no more than its natural size, and a blurred copy covers the margins.
 */
export function StyleExampleImage({ src, alt, className = '' }: Props) {
  return (
    <>
      <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-xl" />
      <img src={src} alt={alt} loading="lazy" className={`absolute inset-0 m-auto max-h-full max-w-full ${className}`} />
    </>
  );
}
