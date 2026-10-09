export type EventCategory = "Conciertos" | "Teatro" | "Deportes" | "Festivales";

export type TicketType = {
  id: string;
  name: string;
  description: string;
  price: number;
  available: number;
};

export type Event = {
  slug: string;
  title: string;
  artist: string;
  category: EventCategory;
  date: string;
  time: string;
  venue: string;
  city: string;
  state: string;
  priceFrom: number;
  colors: string;
  artwork: string;
  description: string;
  tickets: TicketType[];
  featured?: boolean;
};

export function demoZoneId(eventSlug: string, zoneName: string) {
  const input = `${eventSlug}:${zoneName}`;
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const parts = seeds.map((seed) => {
    let hash = seed;
    for (let index = 0; index < input.length; index += 1) {
      hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  });

  const segments = parts.join("").split("");
  segments[12] = "5";
  segments[16] = "89ab"[parseInt(segments[16], 16) & 3];
  const uuid = segments.join("");

  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

export const events: Event[] = [
  {
    slug: "noche-de-luces",
    title: "Noche de luces",
    artist: "Una experiencia para sentirlo todo",
    category: "Festivales",
    date: "2026-11-14",
    time: "19:00",
    venue: "Parque Bicentenario",
    city: "Ciudad de México",
    state: "CDMX",
    priceFrom: 890,
    colors: "event-card--lights",
    artwork: "Luces",
    description:
      "La ciudad se transforma por una noche. Música en vivo, instalaciones inmersivas y miles de luces en un festival para compartir con quien más quieres.",
    tickets: [
      { id: demoZoneId("noche-de-luces", "General"), name: "General", description: "Acceso al festival", price: 890, available: 184 },
      { id: demoZoneId("noche-de-luces", "Preferente"), name: "Preferente", description: "Acceso preferente y zona lounge", price: 1490, available: 62 },
      { id: demoZoneId("noche-de-luces", "VIP"), name: "VIP", description: "Acceso VIP, lounge y bebida de bienvenida", price: 2390, available: 18 },
    ],
    featured: true,
  },
  {
    slug: "natalia-lafourcade",
    title: "Cancionera Tour",
    artist: "Natalia Lafourcade",
    category: "Conciertos",
    date: "2026-10-24",
    time: "20:30",
    venue: "Auditorio Nacional",
    city: "Ciudad de México",
    state: "CDMX",
    priceFrom: 1250,
    colors: "event-card--natalia",
    artwork: "Cancionera",
    description:
      "Una noche íntima con la voz y las canciones de Natalia Lafourcade en uno de los escenarios más emblemáticos de México.",
    tickets: [
      { id: demoZoneId("natalia-lafourcade", "Balcón"), name: "Balcón", description: "Asientos numerados en balcón", price: 1250, available: 123 },
      { id: demoZoneId("natalia-lafourcade", "Pista"), name: "Pista", description: "Asiento numerado en pista", price: 1980, available: 76 },
      { id: demoZoneId("natalia-lafourcade", "Preferente"), name: "Preferente", description: "Primeras filas numeradas", price: 2650, available: 21 },
    ],
    featured: true,
  },
  {
    slug: "pumas-vs-america",
    title: "Pumas vs. América",
    artist: "Clásico Capitalino · Jornada 16",
    category: "Deportes",
    date: "2026-11-01",
    time: "17:00",
    venue: "Estadio Olímpico Universitario",
    city: "Ciudad de México",
    state: "CDMX",
    priceFrom: 450,
    colors: "event-card--futbol",
    artwork: "Clásico",
    description:
      "Vive la pasión del Clásico Capitalino desde las gradas del Estadio Olímpico Universitario. Partido correspondiente a la Jornada 16.",
    tickets: [
      { id: demoZoneId("pumas-vs-america", "Cabecera"), name: "Cabecera", description: "Acceso a zona de cabecera", price: 450, available: 242 },
      { id: demoZoneId("pumas-vs-america", "Planta baja"), name: "Planta baja", description: "Zona lateral en planta baja", price: 780, available: 91 },
      { id: demoZoneId("pumas-vs-america", "Palco"), name: "Palco", description: "Zona techada con asiento preferente", price: 1450, available: 28 },
    ],
    featured: true,
  },
  {
    slug: "el-rey-leon",
    title: "El Rey León",
    artist: "El musical que emociona a México",
    category: "Teatro",
    date: "2026-11-07",
    time: "18:00",
    venue: "Teatro Telcel",
    city: "Ciudad de México",
    state: "CDMX",
    priceFrom: 980,
    colors: "event-card--lion",
    artwork: "Hakuna\nMatata",
    description:
      "Descubre una puesta en escena espectacular, música inolvidable y una historia que ha conquistado a generaciones. Función en español.",
    tickets: [
      { id: demoZoneId("el-rey-leon", "Luneta"), name: "Luneta", description: "Asiento numerado en luneta", price: 980, available: 134 },
      { id: demoZoneId("el-rey-leon", "Preferente"), name: "Preferente", description: "Mejor visibilidad, asiento numerado", price: 1580, available: 58 },
      { id: demoZoneId("el-rey-leon", "Premium"), name: "Premium", description: "Filas preferentes y acceso prioritario", price: 2280, available: 16 },
    ],
    featured: true,
  },
  {
    slug: "carla-morrison-guadalajara",
    title: "El renacimiento Tour",
    artist: "Carla Morrison",
    category: "Conciertos",
    date: "2026-11-21",
    time: "21:00",
    venue: "Teatro Diana",
    city: "Guadalajara",
    state: "Jalisco",
    priceFrom: 690,
    colors: "event-card--carla",
    artwork: "Renacimiento",
    description:
      "Carla Morrison llega a Guadalajara para una noche inolvidable de canciones que se sienten cerquita.",
    tickets: [
      { id: demoZoneId("carla-morrison-guadalajara", "Balcón"), name: "Balcón", description: "Asiento numerado en balcón", price: 690, available: 89 },
      { id: demoZoneId("carla-morrison-guadalajara", "Luneta"), name: "Luneta", description: "Asiento numerado en luneta", price: 1190, available: 44 },
      { id: demoZoneId("carla-morrison-guadalajara", "VIP"), name: "VIP", description: "Luneta preferente y acceso prioritario", price: 1790, available: 12 },
    ],
    featured: true,
  },
  {
    slug: "festival-del-pacifico",
    title: "Festival del Pacífico",
    artist: "Dos días frente al mar",
    category: "Festivales",
    date: "2026-12-05",
    time: "16:00",
    venue: "Playa Tamarindos",
    city: "Acapulco",
    state: "Guerrero",
    priceFrom: 1290,
    colors: "event-card--pacifico",
    artwork: "Pacífico",
    description:
      "Dos días de música, amigos y atardeceres en Playa Tamarindos. Un festival para terminar el año como se debe.",
    tickets: [
      { id: demoZoneId("festival-del-pacifico", "Abono general"), name: "Abono general", description: "Acceso ambos días al festival", price: 1290, available: 203 },
      { id: demoZoneId("festival-del-pacifico", "Abono preferente"), name: "Abono preferente", description: "Acceso preferente ambos días", price: 1990, available: 67 },
      { id: demoZoneId("festival-del-pacifico", "Abono VIP"), name: "Abono VIP", description: "Zona VIP y acceso prioritario ambos días", price: 3290, available: 24 },
    ],
    featured: true,
  },
  {
    slug: "charros-vs-tomateros",
    title: "Charros vs. Tomateros",
    artist: "Béisbol de invierno",
    category: "Deportes",
    date: "2026-10-30",
    time: "19:30",
    venue: "Estadio Panamericano",
    city: "Zapopan",
    state: "Jalisco",
    priceFrom: 280,
    colors: "event-card--beisbol",
    artwork: "Play ball",
    description:
      "Una noche de pelota caliente y ambiente familiar en el Estadio Panamericano. ¡Apoya a Charros en casa!",
    tickets: [
      { id: demoZoneId("charros-vs-tomateros", "Jardines"), name: "Jardines", description: "Acceso a zona de jardines", price: 280, available: 314 },
      { id: demoZoneId("charros-vs-tomateros", "Lateral"), name: "Lateral", description: "Asiento numerado en zona lateral", price: 520, available: 116 },
      { id: demoZoneId("charros-vs-tomateros", "Dugout"), name: "Dugout", description: "Zona techada junto al diamante", price: 980, available: 32 },
    ],
    featured: true,
  },
  {
    slug: "teatro-una-familia",
    title: "Una familia de diez",
    artist: "La comedia que ya conoces",
    category: "Teatro",
    date: "2026-12-12",
    time: "19:00",
    venue: "Teatro Galerías",
    city: "Zapopan",
    state: "Jalisco",
    priceFrom: 550,
    colors: "event-card--theater",
    artwork: "¡Qué familia!",
    description:
      "Reúne a toda la familia para disfrutar esta divertidísima comedia mexicana en vivo. ¡Las risas están garantizadas!",
    tickets: [
      { id: demoZoneId("teatro-una-familia", "Balcón"), name: "Balcón", description: "Asiento numerado en balcón", price: 550, available: 107 },
      { id: demoZoneId("teatro-una-familia", "Luneta"), name: "Luneta", description: "Asiento numerado en luneta", price: 850, available: 63 },
      { id: demoZoneId("teatro-una-familia", "Preferente"), name: "Preferente", description: "Asiento preferente numerado", price: 1190, available: 20 },
    ],
    featured: true,
  },
];

export const categories: Array<"Todos" | EventCategory> = [
  "Todos",
  "Conciertos",
  "Festivales",
  "Deportes",
  "Teatro",
];

export const cities = [
  "Todas las ciudades",
  ...Array.from(new Set(events.map((event) => event.city))),
];

export function formatPrice(price: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price);
}

export function formatDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
