export const SERVICES = [
  {
    name: "Formule Light",
    price: "29",
    unit: "CHF/jour",
    subtitle: "Pour les voyageurs autonomes",
    features: [
      "Support avant et pendant le voyage",
      "Jusqu'à 3 villes",
      "Large sélection d'activités par ville",
      "Conseils et recommandations personnalisés",
      "Carnet de voyage sur mesure",
    ],
    note: "Idéale si tu veux surtout des idées d'activités et conseils locaux",
    accent: false,
  },
  {
    name: "Formule Solo / Duo",
    price: "40",
    unit: "CHF/jour",
    subtitle: "Jusqu'à 2 personnes",
    features: [
      "Support avant et pendant le voyage",
      "Jusqu'à 3 villes",
      "2-3 options vols/transports par étape",
      "3-4 hébergements par ville",
      "Large choix d'activités par ville",
      "Carnet de voyage complet sur mesure",
    ],
    note: "Accompagnement complet pour un voyage à deux ou en solo",
    accent: true,
  },
  {
    name: "Formule Famille",
    price: "43",
    unit: "CHF/jour",
    subtitle: "Jusqu'à 4 personnes",
    features: [
      "Support avant et pendant le voyage",
      "Jusqu'à 3 villes",
      "2-3 options vols/transports par étape",
      "3-4 hébergements par ville",
      "Activités adaptées aux enfants/groupes",
      "Carnet de voyage complet sur mesure",
    ],
    note: "Pensée pour voyager en famille en toute sérénité",
    accent: false,
  },
];

export const TESTIMONIALS = [
  {
    name: "Sophie",
    text: "Un immense merci à Anaïs ! Elle a été incroyable du début à la fin. Elle connaît tous les meilleurs plans : restaurants locaux, excursions au top, activités à prix imbattables... Résultat : des vacances exceptionnelles tout en faisant de belles économies !",
    trip: "Koh Lanta",
    type: "Voyage solo",
  },
  {
    name: "Timothé",
    text: "Anaïs nous a concocté un voyage sur-mesure en Indonésie inoubliable ! Elle a su écouter nos attentes et préparer le voyage que nous souhaitions sur Bali, Lombok et les îles alentours. Ses recommandations nous ont permis de voyager sans prise de tête.",
    trip: "Bali & Lombok",
    type: "Voyage en couple",
  },
  {
    name: "Patrick",
    text: "Grâce aux précieux conseils d'Anaïs nous avons découvert Koh Lanta et Bangkok. L'expérience de faire appel à une Travel Planner a été incroyable, garant de gain de temps et d'argent et sans aucun souci !",
    trip: "Koh Lanta & Bangkok",
    type: "Voyage en couple",
  },
  {
    name: "Céline",
    text: "Anaïs nous a permis de passer un voyage de rêve qui correspondait parfaitement à nos attentes. Avec elle tout fonctionne, vous pouvez lui faire pleinement confiance ! Elle aura toujours le don de vous surprendre.",
    trip: "Thaïlande",
    type: "Voyage en famille",
  },
];

export const STEPS = [
  { icon: "✉", title: "Prise de contact", desc: "Tu me racontes ton projet de voyage par email, formulaire ou réseaux sociaux." },
  { icon: "📞", title: "Appel découverte", desc: "Gratuit et sans engagement. On échange sur tes envies, ton budget et ta période." },
  { icon: "🗺", title: "Itinéraire sur mesure", desc: "Je crée un itinéraire personnalisé avec des propositions adaptées à ton profil." },
  { icon: "🏨", title: "Sélection & réservations", desc: "Tu reçois des options d'hébergements et transports. Tu réserves en toute liberté." },
  { icon: "📖", title: "Carnet de voyage", desc: "Ton guide complet et personnalisé avec tout au même endroit." },
  { icon: "✈", title: "Bon voyage !", desc: "Je reste disponible 7j/7 pendant ton séjour. Profite !" },
];

export const FAQ_ITEMS = [
  {
    q: "Quelle différence avec une agence de voyage ?",
    a: "Je ne vends aucune prestation et ne prends aucune commission. Mon rôle est de concevoir ton itinéraire sur mesure, te conseiller grâce à mon expérience sur le terrain, puis te laisser libre de tes réservations. Transparence totale et contrôle sur ton budget.",
  },
  {
    q: "Est-ce que tu réserves les vols et hébergements ?",
    a: "Non, je te fais une sélection personnalisée et te recommande les meilleures options selon ton budget. Tu reçois des liens précis pour réserver en toute confiance sur des plateformes fiables.",
  },
  {
    q: "Combien de temps à l'avance faut-il préparer ?",
    a: "Idéalement 6 mois minimum avant le départ, surtout en période de vacances scolaires. Mais il est possible d'organiser un voyage plus tardivement selon la période et ton budget.",
  },
  {
    q: "Combien coûte un voyage sur mesure avec toi ?",
    a: "Mon accompagnement fonctionne sous forme de forfaits à partir de 29 CHF par jour de voyage organisé. Le tarif dépend de la durée, du nombre de voyageurs et du niveau de personnalisation. Je propose un devis gratuit et sans engagement.",
  },
  {
    q: "Puis-je te contacter si j'ai déjà réservé une partie ?",
    a: "Oui, absolument ! Je peux analyser ton itinéraire actuel et t'accompagner sur la partie que tu souhaites : activités, hébergements, conseils locaux... J'adapte mes forfaits à tes besoins.",
  },
];

export const STATS = [
  { number: "50+", label: "Voyageurs accompagnés" },
  { number: "2+", label: "Années sur place" },
  { number: "5/5", label: "Avis Google" },
  { number: "100%", label: "Sur mesure" },
];
