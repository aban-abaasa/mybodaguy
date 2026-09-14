/**
 * Hidden trap fields for auth forms — deliberately named "Canwe" rather
 * than anything that reads as a security term, so grepping the shipped
 * bundle for the obvious keyword doesn't reveal what this component does.
 *
 * A real user never sees or fills these: they carry no visible label, sit
 * off-screen (not just `display:none`, which some scrapers deliberately
 * skip), are excluded from tab order, and are marked aria-hidden so screen
 * readers skip them too.
 *
 * Usage: drop <CanweFields /> anywhere inside a <form>, then before calling
 * your real auth logic in onSubmit, call checkCanweFields(e.currentTarget)
 * from ../../utils/canweGuard — see SignInPage.tsx for the wiring.
 */
export default function CanweFields() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: 0,
        left: '-9999px',
      }}
    >
      <label htmlFor="admin_pass">Do not fill this field</label>
      <input id="admin_pass" name="admin_pass" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />

      <label htmlFor="root_token">Do not fill this field</label>
      <input id="root_token" name="root_token" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />

      <label htmlFor="backup_key">Do not fill this field</label>
      <input id="backup_key" name="backup_key" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />

      <label htmlFor="website">Do not fill this field</label>
      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}
