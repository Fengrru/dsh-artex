// One activity record has two possible stable keys: ARTEX's activity DTO uses
// `seq`, while the mock and older payloads used `id`. Both the Host tool and
// the browser panel must agree on the same key for dedupe and cursors.

export function activityKey(item) {
  return item?.id ?? item?.seq
}
