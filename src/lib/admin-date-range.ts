const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const REPORT_TIME_ZONE = "America/Mexico_City";

export function zonedDateTimeToUtc(value: string, timeZone: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new RangeError("La fecha y hora local no es válida.");

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] =
    match;
  const targetParts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  const targetTimestamp = Date.UTC(
    targetParts.year,
    targetParts.month - 1,
    targetParts.day,
    targetParts.hour,
    targetParts.minute,
    targetParts.second,
  );
  const targetDate = new Date(targetTimestamp);
  if (
    !Number.isFinite(targetTimestamp) ||
    targetDate.getUTCFullYear() !== targetParts.year ||
    targetDate.getUTCMonth() + 1 !== targetParts.month ||
    targetDate.getUTCDate() !== targetParts.day ||
    targetParts.hour > 23 ||
    targetParts.minute > 59 ||
    targetParts.second > 59
  ) {
    throw new RangeError("La fecha y hora local no es válida.");
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let candidateTimestamp = targetTimestamp;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const formatted = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidateTimestamp))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const observedTimestamp = Date.UTC(
      formatted.year,
      formatted.month - 1,
      formatted.day,
      formatted.hour,
      formatted.minute,
      formatted.second,
    );
    const offset = observedTimestamp - targetTimestamp;
    if (offset === 0) return new Date(candidateTimestamp);
    candidateTimestamp -= offset;
  }

  throw new RangeError(
    "La hora local no existe por el cambio de horario de la zona seleccionada.",
  );
}

function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseAdminReportRange(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.getAll("from").length > 1 || params.getAll("to").length > 1) {
    return { ok: false as const, error: "Indica un solo valor para cada fecha." };
  }

  const end = params.get("to") ?? new Date().toISOString().slice(0, 10);
  const defaultStart = new Date(Date.now() - 29 * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const start = params.get("from") ?? defaultStart;
  if (!isValidDate(start) || !isValidDate(end)) {
    return { ok: false as const, error: "Usa fechas válidas con formato AAAA-MM-DD." };
  }

  const startAt = new Date(`${start}T00:00:00.000Z`);
  const endAt = new Date(`${end}T00:00:00.000Z`);
  const dayCount = Math.floor((endAt.getTime() - startAt.getTime()) / MILLISECONDS_PER_DAY) + 1;
  if (dayCount < 1 || dayCount > MAX_RANGE_DAYS) {
    return {
      ok: false as const,
      error: "El periodo debe ser de hasta 366 días y la fecha inicial no puede superar a la final.",
    };
  }

  return {
    ok: true as const,
    from: start,
    to: end,
    startAt: zonedDateTimeToUtc(`${start}T00:00`, REPORT_TIME_ZONE),
    endExclusive: zonedDateTimeToUtc(
      `${new Date(endAt.getTime() + MILLISECONDS_PER_DAY).toISOString().slice(0, 10)}T00:00`,
      REPORT_TIME_ZONE,
    ),
  };
}
