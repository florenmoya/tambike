const NEXT_ACTION_FIELD_PREFIX = "$ACTION_";

export function formDataToStrictInput(formData: FormData) {
  return Object.fromEntries(
    [...formData.entries()].filter(
      ([name]) => !name.startsWith(NEXT_ACTION_FIELD_PREFIX),
    ),
  );
}
