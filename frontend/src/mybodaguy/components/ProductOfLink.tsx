import { PRODUCT_OWNER, PRODUCT_OWNER_URL } from '../../constants/brand';

/**
 * "A product of GODMINDERA ORGANISATION (U) LTD" with the company name opening its website (icanera.space/godmindera-organisation-u-ltd).
 * Drop-in for the plain credit text in a footer: it inherits the footer's colour and size, so only the underline tells it is a link.
 */
export default function ProductOfLink({
  prefix = 'A product of',
  className = 'underline underline-offset-2 hover:opacity-80',
}: { prefix?: string; className?: string }) {
  return (
    <>
      {prefix}{' '}
      <a href={PRODUCT_OWNER_URL} target="_blank" rel="noopener noreferrer" className={className}>{PRODUCT_OWNER}</a>
    </>
  );
}
