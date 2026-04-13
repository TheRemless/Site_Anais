import { useParams, Link } from "react-router-dom";
import "../styles/pages.css";

const WP_IMG = (filename) =>
  `https://zwaldtravelplanner.wordpress.com/wp-content/uploads/${filename}`;

const BLOG_CONTENT = {

  /* ============================================================
     ARTICLE 1 — 2 semaines en Thaïlande
     ============================================================ */
  "2-semaines-en-thailande": {
    title: "2 semaines en Thaïlande — L'itinéraire parfait + conseils locaux",
    category: "Itinéraire",
    date: "20 mars 2026",
    content: `
      <p>Organiser un voyage de 2 semaines en Thaïlande peut vite devenir un vrai casse-tête, surtout lorsque c'est le premier, qu'on n'a souvent pas beaucoup de temps… Entre les nombreuses îles, les différentes régions, les temples et activités incontournables, les trajets à optimiser et les pièges à éviter, il est difficile de savoir par où commencer.</p>
      <p>Après plus de 3 ans à vivre en Thaïlande et à créer des itinéraires sur mesure pour mes clients, je te partage ici une base d'itinéraire de 14 jours, optimisée pour un premier voyage.</p>
      <p><strong>⚠️ Attention :</strong> cet article te donne une structure globale, mais chaque voyage nécessite d'être adapté selon ton budget, ton rythme, tes besoins et la saison.</p>

      <img src="/images/itineraire-2-semaines-en-thailande.png" alt="Itinéraire 2 semaines en Thaïlande" class="blog-img" />

      <h2>🗺️ L'itinéraire de base (14 jours)</h2>
      <p>Voici une structure classique et efficace pour un premier voyage en Thaïlande, à adapter ensuite selon la saison et ton style de voyage !</p>

      <h3>👉 Jour 1 à 3 — Bangkok</h3>
      <p>Commence ton voyage par la capitale, un mélange fascinant de modernité et de traditions. Mes clients partent souvent avec un avis mitigé concernant Bangkok, et en reviennent la plupart du temps bluffés. Entre ses temples emblématiques, ses marchés locaux, ses quartiers insolites, sa street food mondialement reconnue, ses rooftops modernes avec vue imprenable sur la ville et même ses immenses parcs verdoyants, la capitale offre une immersion unique dans la culture thaïlandaise.</p>
      <p><strong>⚠️ Mais attention :</strong> Bangkok est aussi une ville connue pour être très grande, bruyante, très peuplée et toujours coincée dans les embouteillages. Il est donc essentiel de bien choisir son quartier et de savoir utiliser les transports locaux (BTS, MRT, bateaux sur le fleuve, taxis, Grab) pour éviter de perdre un temps précieux dans les déplacements.</p>
      <p><strong>💡 Conseil local :</strong> contrairement aux idées reçues, Bangkok ne se résume pas à une ville bétonnée et bruyante :</p>
      <ul>
        <li>Certains quartiers sont beaucoup plus authentiques et paisibles, parfaits pour ceux qui aiment moins les grandes villes</li>
        <li>On y trouve aussi de très beaux espaces verts, véritables bulles de calme au cœur de la ville</li>
      </ul>
      <p>👉 À ne pas manquer également :</p>
      <ul>
        <li>Une croisière ou un trajet en bateau sur le fleuve, surtout en fin de journée — Bangkok y révèle une toute autre ambiance, beaucoup plus douce et apaisante</li>
        <li>Une excursion à Ayutthaya (ancienne capitale du royaume), faisable à la journée ou sur une nuit pour une expérience plus immersive dans cette ville remplie de temples et vestiges du passé</li>
      </ul>
      <p>Pour les oiseaux de nuit, l'ambiance nocturne est aussi très présente, entre les ruelles animées de Chinatown ou certaines zones festives comme Khao San Road ou les rooftops du quartier de Sukhumvit. Bangkok est une ville aux mille facettes, et bien la comprendre dès le départ change complètement l'expérience du voyage.</p>

      <h3>👉 Jour 4 à 8 — Nord de la Thaïlande</h3>
      <p>Direction le nord, encore trop sous-estimé, que je considère comme la région la plus authentique du pays (sans compter la région d'Issan au Nord-Est, encore plus préservée). Ici, l'ambiance change totalement : plus calme, plus naturelle, plus traditionnelle. On s'y rend en avion ou en train de nuit pour une expérience plus locale !</p>
      <p>🌿 Beaucoup de voyageurs se limitent à Chiang Mai… mais le nord ne s'arrête pas là ! C'est une région riche en expériences diverses et variées :</p>
      <ul>
        <li>temples magnifiques et chargés d'histoire</li>
        <li>randonnées dans les montagnes</li>
        <li>treks avec des locaux, incluant parfois des expériences authentiques comme cuisiner dans la forêt avec du bambou</li>
        <li>rizières, plantations de thé et paysages naturels</li>
        <li>cascades, villages locaux et marchés de nuit…</li>
      </ul>
      <p>🐘 Le nord est aussi connu pour ses sanctuaires d'éléphants. Mais attention : tous ne sont malheureusement pas éthiques… Il est essentiel de bien les sélectionner pour vivre une expérience respectueuse des animaux. C'est également un point qui me tient à cœur lors de l'organisation de mes voyages. Certaines expériences incluent même la possibilité de loger dans un sanctuaire et d'observer les éléphants dès le réveil. Une expérience unique, à condition d'être bien conseillé·e !</p>
      <p>C'est une région malheureusement encore trop oubliée des touristes, qui est pourtant idéale pour ralentir, se reconnecter à la nature et découvrir une autre facette de la Thaïlande. Car non, la Thaïlande ce n'est pas que des plages de sable blanc et de l'eau turquoise — c'est en réalité bien plus que ça, et c'est ce que j'aime faire découvrir à mes clients.</p>

      <h3>👉 Jour 9 à 14 — Les îles du sud 🏝️</h3>
      <p>Allez, place à la détente dans les îles du sud, avec leurs plages paradisiaques, leurs eaux turquoises et leurs paysages de carte postale. Je sais bien que vous venez en Thaïlande pour ça ! Et en effet, c'est souvent la partie la plus attendue du voyage… mais aussi la plus complexe à organiser.</p>
      <p>Pourquoi ?</p>
      <ul>
        <li>Les hébergements se remplissent très vite, parfois plusieurs mois à l'avance</li>
        <li>La météo varie énormément entre la côte ouest (mer d'Andaman) et la côte est (golfe de Thaïlande)</li>
        <li>Certaines îles sont très touristiques, d'autres encore préservées — mais plus difficiles d'accès</li>
        <li>Chaque île a sa particularité et peut correspondre plus ou moins à vos attentes et besoins</li>
      </ul>
      <p>Bien choisir sa zone en fonction de ses dates est absolument essentiel.</p>
      <p>Côté activités, les possibilités sont nombreuses des deux côtés :</p>
      <ul>
        <li>snorkeling et excursions en bateau</li>
        <li>privatisation de longtail boat traditionnel pour explorer les îles</li>
        <li>cours de cuisine thaïe</li>
        <li>massages sur la plage</li>
        <li>marchés locaux et gastronomie</li>
        <li>temples et expériences culturelles</li>
        <li>et bien d'autres !</li>
      </ul>
      <p>Côté différences :</p>
      <ul>
        <li>La côte ouest (hors certaines zones comme Phuket) reste plus sauvage avec des îles encore préservées du tourisme de masse</li>
        <li>La côte est est souvent plus accessible, avec de très belles plages, des eaux turquoises et des activités adaptées aux familles (et notamment la possibilité d'observer des tortues selon les îles !)</li>
      </ul>
      <p>C'est une région où les choix font toute la différence pour une fin de séjour inoubliable.</p>

      <h2>🌦️ La saison change tout</h2>
      <p>Comme je le disais, contrairement à ce que l'on pense, on ne peut pas choisir ses îles en Thaïlande au hasard. Le pays est divisé en plusieurs zones climatiques, avec des saisons différentes selon les régions.</p>
      <p>Résultat : une île peut être paradisiaque à une période et très pluvieuse à une autre.</p>
      <p><strong>💡 Exemple concret :</strong> certaines îles sont idéales pour les vacances d'hiver (la mienne par exemple 😍), tandis que d'autres seront beaucoup plus agréables en été. C'est pour cette raison que la structure de l'itinéraire reste souvent la même (Bangkok + nord + îles), mais que le choix des destinations dans le sud doit être adapté à tes dates de voyage si tu veux vraiment en profiter. Et c'est précisément là que beaucoup de voyageurs se trompent…</p>

      <h2>🚨 Les erreurs les plus fréquentes</h2>
      <p>Pour ne pas refaire les mêmes erreurs, voici celles que je vois le plus souvent chez mes clients :</p>
      <ul>
        <li>Choisir ses îles sans tenir compte de la saison</li>
        <li>Suivre un itinéraire trouvé sur internet sans l'adapter</li>
        <li>Vouloir trop en faire en peu de temps (et au final survoler le pays sans vraiment en profiter)</li>
        <li>Sous-estimer les temps de transport (le pays est grand !)</li>
        <li>Ne pas prévoir de temps de repos ou de flexibilité dans le voyage</li>
        <li>Réserver des activités trop touristiques ou peu qualitatives</li>
        <li>Croire tout ce que l'on voit sur les réseaux sociaux</li>
        <li>Partir sans connaître un minimum la culture locale (je vous promets, ça peut changer un voyage)</li>
        <li>…et bien sûr : penser qu'organiser seul son voyage permet d'économiser de l'argent</li>
      </ul>
      <p>Alors qu'en réalité, c'est souvent l'inverse : mauvais choix d'itinéraire, hôtels mal situés, activités décevantes, transports pas optimisés, mauvaise connaissance de la culture locale… Résultat : perte de temps, d'énergie et d'argent… alors qu'un itinéraire bien pensé permet d'optimiser chaque aspect du voyage et même de faire des économies là où vous ne le soupçonneriez même pas !</p>

      <h2>🌏 Une infinité d'itinéraires possibles</h2>
      <p>Cet itinéraire de 2 semaines est une excellente base pour un premier voyage en Thaïlande… mais il est loin d'être le seul possible ! Par exemple :</p>
      <ul>
        <li><strong>Hua Hin :</strong> une station balnéaire plus calme et authentique, idéale pour un séjour reposant à proximité de Bangkok, autant entourée de la mer que de nombreuses activités en pleine nature, sans devoir prendre encore un vol intérieur (et beaucoup plus économique !)</li>
        <li><strong>Khao Sok National Park :</strong> une immersion en pleine jungle, avec ses célèbres bungalows flottants sur un lac entouré de formations karstiques. Randonnées, animaux, cascades, nuit sur le lac, safari de nuit et de jour… une expérience unique pour les amoureux de la nature, allant des simples cabanes petits budgets aux lodges de luxe.</li>
        <li>Un voyage à travers le nord en prenant le train d'une ville à une autre, pour une expérience plus lente et immersive.</li>
        <li>Un itinéraire entièrement dédié aux îles du sud, pour profiter au maximum des plages et de la mer, des îles les plus authentiques aux plus animées.</li>
      </ul>
      <p>Certains voyageurs préfèrent ralentir et explorer moins d'endroits, d'autres veulent varier les expériences… lors de mes accompagnements, je m'adapte à chaque envie, tout en leur faisant des recommandations selon leur profil. Il n'existe pas "un" itinéraire parfait, mais <em>ton</em> itinéraire idéal, celui qui correspond exactement au voyage que tu imagines.</p>

      <h2>✨ Pourquoi se faire accompagner ?</h2>
      <p>Pour résumer, construire un itinéraire en Thaïlande ne se résume pas à choisir des destinations. Il faut prendre en compte :</p>
      <ul>
        <li>la saison et la météo</li>
        <li>la logique des déplacements</li>
        <li>ton rythme et style de voyage</li>
        <li>les expériences sur place selon tes envies</li>
        <li>ton budget total</li>
      </ul>
      <p>En tant que Travel Planner basée en Thaïlande, mon métier est de t'aider à :</p>
      <ul>
        <li>✨ Adapter ton itinéraire à ta période de voyage, à tes envies et à ton budget</li>
        <li>✨ Éviter les erreurs classiques</li>
        <li>✨ Gagner un temps précieux sur l'organisation</li>
        <li>✨ Partir l'esprit plus tranquille</li>
        <li>✨ Profiter d'un voyage cohérent, adapté à la réalité du terrain</li>
      </ul>
      <p>Chaque itinéraire que je crée est 100% personnalisé, selon le voyage de tes rêves.</p>
      <p>💌 <strong>Tu veux un itinéraire parfaitement adapté à ta période et à ton style de voyage ?</strong> En plus de créer avec toi ton itinéraire idéal, je crée pour toi un carnet de voyage complet et personnalisé avec :</p>
      <ul>
        <li>🏝️ un itinéraire personnalisé avec des suggestions d'activités jour par jour (ou par région)</li>
        <li>🌿 une sélection d'hébergements par région, selon tes critères</li>
        <li>🏯 des conseils pour les transports et vols</li>
        <li>🍜 mes conseils locaux exclusifs, recommandations, contacts…</li>
      </ul>
    `
  },

  /* ============================================================
     ARTICLE 2 — Les erreurs à éviter
     ============================================================ */
  "erreurs-a-eviter-thailande": {
    title: "Voyage en Thaïlande : les erreurs à éviter absolument (et comment les éviter)",
    category: "Conseils",
    date: "19 décembre 2025",
    content: `
      <p>La Thaïlande (ou Asie du Sud-Est) fait rêver… et c'est justement pour ça que beaucoup de voyageurs font les mêmes erreurs. Itinéraires irréalistes, régions mal choisies, informations contradictoires trouvées sur Internet : organiser un voyage en Thaïlande peut vite devenir source de stress.</p>
      <p>En tant que Travel Planner en Thaïlande, j'accompagne régulièrement des voyageurs qui me contactent après avoir passé des heures à faire des recherches, sans être sûrs de leurs choix. Dans cet article, je te partage les erreurs les plus fréquentes et comment les éviter pour vivre un voyage plus fluide, plus serein et vraiment adapté à toi.</p>

      <img src="${WP_IMG('2025/12/erreurs-voyage-thailande-1.jpg-1-edited.jpg')}" alt="Erreurs à éviter lors d'un voyage en Thaïlande" class="blog-img" />

      <h2>Erreur n°1 : vouloir trop en voir en trop peu de temps</h2>
      <p>C'est l'erreur la plus classique. La Thaïlande est un grand pays, et les distances sont souvent sous-estimées.</p>
      <p>Beaucoup de voyageurs veulent voir : « Bangkok + le nord + plusieurs îles en 10 jours » (vécu de nombreuses fois avec mes clients)</p>
      <p>Résultat ?</p>
      <ul>
        <li>trop de transports</li>
        <li>perte de temps et d'argent</li>
        <li>voyage fatiguant</li>
        <li>peu de temps pour profiter</li>
        <li>frustration / déception du voyage…</li>
      </ul>
      <p>Un voyage réussi, ce n'est pas cocher toutes les régions sur une carte, c'est trouver le bon rythme, adapté à ton style de voyage.</p>

      <h2>Erreur n°2 : mal gérer les distances et les transports</h2>
      <p>Sur Google Maps, tout paraît simple et proche. Dans la réalité :</p>
      <ul>
        <li>certains trajets peuvent prendre une journée entière</li>
        <li>les correspondances demandent de l'anticipation</li>
        <li>les zones de prises en charge peuvent être éloignées</li>
        <li>tous les déplacements ne sont pas confortables ou logiques</li>
      </ul>
      <p>Ne pas intégrer ces contraintes dès le départ peut déséquilibrer tout l'itinéraire et vous faire perdre énormément de temps.</p>

      <h2>Erreur n°3 : mal choisir la période de voyage (et les régions)</h2>
      <p>« Il pleut en Thaïlande en août ? » « C'est la saison des pluies partout ? »</p>
      <p><strong>Faux.</strong></p>
      <p>La météo en Thaïlande varie énormément selon les régions. Et un mauvais choix de zones peut entraîner :</p>
      <ul>
        <li>beaucoup de pluie</li>
        <li>une mer agitée</li>
        <li>des excursions et activités annulées voire indisponibles à certaines périodes</li>
        <li>des déceptions ou frustrations lors de votre séjour</li>
      </ul>

      <h2>Erreur n°4 : mal choisir ses régions selon son style de voyage</h2>
      <p>Toutes les régions de Thaïlande ne se ressemblent pas. Pourtant, beaucoup de voyageurs choisissent leurs destinations :</p>
      <ul>
        <li>parce que « tout le monde y va »</li>
        <li>parce que ça leur a été recommandé</li>
        <li>parce que c'est populaire sur les réseaux</li>
        <li>sans faire de recherches adaptées à leurs envies et besoins réels</li>
      </ul>
      <p>Voyage détente, aventure, nature, culture, famille, couple, solo… Le bon itinéraire dépend avant tout de ton style de voyage, pas des tendances !</p>

      <h2>Erreur n°5 : ne voir que les régions très touristiques</h2>
      <p>Certaines zones sont magnifiques… mais aussi très fréquentées. Si ce n'est pas ce que tu recherches, l'expérience peut être décevante. La Thaïlande possède pourtant encore :</p>
      <ul>
        <li>des régions plus calmes</li>
        <li>des îles moins connues</li>
        <li>des expériences authentiques</li>
      </ul>
      <p>Mais il faut savoir où aller et quand. Et cela dépend de beaucoup de facteurs (durée de ton séjour, style de voyage, budget, envies…)</p>

      <h2>Erreur n°6 : ne pas se renseigner sur la culture locale</h2>
      <p>La Thaïlande a une culture riche, avec ses codes, ses habitudes et ses règles, comme chaque pays. Ne pas les connaître peut souvent entraîner des malentendus, des comportements maladroits et une expérience moins respectueuse, pouvant être frustrante.</p>
      <p>Se renseigner sur la culture locale permet de voyager :</p>
      <ul>
        <li>avec plus de compréhension du pays et de ses habitants</li>
        <li>de manière plus respectueuse et éthique</li>
        <li>et souvent avec plus de plaisir et de meilleurs souvenirs !</li>
      </ul>

      <h2>Erreur n°7 : mal faire ses recherches et tout croire sur Internet</h2>
      <p>Blogs, forums, photos et vidéos sur les réseaux sociaux… Les informations sont partout et en grand nombre. Et c'est bien ça le problème, car elles peuvent être parfois contradictoires, obsolètes, inadaptées à ton profil ou à la réalité du terrain.</p>
      <p>Beaucoup de voyageurs passent des dizaines d'heures à chercher, sans être sûrs de faire les bons choix et même de trouver les bonnes informations…</p>

      <img src="${WP_IMG('2025/12/erreur-voyage-thailande.jpg-edited.jpg')}" alt="Erreurs à éviter lors d'un voyage en Thaïlande" class="blog-img" />

      <h2>Comment éviter toutes ces erreurs sans passer par une agence ?</h2>
      <p>Organiser son voyage soi-même, c'est possible ! Mais être accompagné ne signifie pas perdre sa liberté. Savais-tu qu'il existait des alternatives aux agences de voyages traditionnelles ?</p>
      <p>En tant que Travel Planner en Thaïlande, mon rôle est de :</p>
      <ul>
        <li>comprendre ton style de voyage et ton budget</li>
        <li>te créer un itinéraire cohérent et réaliste</li>
        <li>t'aider à faire les bons choix au bon moment</li>
        <li>te faire gagner un temps précieux</li>
        <li>alléger ta charge mentale liée à l'organisation et aux préparatifs (oui, tu contrôles toujours tout, mais les vacances c'est fait pour se détendre !)</li>
      </ul>
      <p>Je te crée un carnet de voyage personnalisé, clair et pratique, et je t'accompagne personnellement avant et pendant ton séjour.</p>
      <p>Tu gardes la liberté de réserver toi-même ce que tu préfères, tout en partant avec une vision claire et sereine d'un voyage adapté à tes besoins et bien organisé.</p>

      <h2>Voyager sereinement, c'est aussi une question d'accompagnement</h2>
      <p>Un voyage réussi, ce n'est pas seulement une destination. C'est aussi :</p>
      <ul>
        <li>moins de stress</li>
        <li>moins de doutes</li>
        <li>moins de charge mentale</li>
        <li>plus de plaisir</li>
        <li>plus de liberté sur place</li>
        <li>plus de détente !</li>
      </ul>
      <p>Si tu veux organiser un voyage sur mesure en Thaïlande, adapté à tes envies, à ton rythme et à ton budget, je serai ravie de t'accompagner.</p>
    `
  },

  /* ============================================================
     ARTICLE 3 — Organiser sans agence
     ============================================================ */
  "organiser-voyage-thailande-sans-agence": {
    title: "Comment organiser un voyage en Thaïlande sans agence (guide complet et conseils pratiques)",
    category: "Guide",
    date: "12 décembre 2025",
    content: `
      <p>Organiser un voyage en Thaïlande sans passer par une agence peut sembler simple au premier abord. Pourtant, entre les distances, les transports, les saisons, les choix d'îles ou de régions, beaucoup de voyageurs se sentent rapidement dépassés.</p>
      <p>En tant que Travel Planner en Thaïlande, j'accompagne des personnes qui souhaitent organiser un voyage sur mesure, sans stress, tout en gardant la maîtrise de leurs réservations. Dans cet article, je t'explique comment organiser ton voyage seul, étape par étape, et à quel moment se faire accompagner peut vraiment faire la différence.</p>

      <img src="${WP_IMG('2025/12/voyage-sur-mesure-thailande-edited.jpg')}" alt="Voyage sur mesure en Thaïlande — Koh Lanta" class="blog-img" />

      <h2>Pourquoi organiser un voyage en Thaïlande sans agence ?</h2>
      <p>Voyager sans agence permet une grande liberté. Tu choisis ton rythme, tes hébergements, tes activités et tu adaptes ton itinéraire selon tes envies. La Thaïlande est un pays relativement facile à explorer, avec de bonnes infrastructures touristiques et une grande variété de paysages : villes animées, plages, rizières, cascades, temples, montagnes…</p>
      <p>Cependant, cette liberté demande aussi :</p>
      <ul>
        <li>beaucoup de temps pour planifier</li>
        <li>savoir où chercher les bonnes informations</li>
        <li>une compréhension réaliste des distances, des saisons, des différentes régions…</li>
      </ul>
      <p>C'est souvent là que les premières difficultés apparaissent…</p>

      <h2>Les étapes essentielles pour organiser un voyage en Thaïlande sans agence</h2>

      <h3>Définir la durée et le rythme du voyage</h3>
      <p>Avant toute chose, il est important de savoir combien de jours tu as réellement à disposition. La Thaïlande est plus grande qu'on ne l'imagine ! Et vouloir trop en faire est l'erreur la plus fréquente.</p>
      <p>Un voyage réussi repose sur :</p>
      <ul>
        <li>un rythme équilibré (détente, découverte, activités)</li>
        <li>des temps et jours de repos</li>
        <li>des déplacements cohérents pour ne pas perdre trop de temps</li>
      </ul>

      <img src="${WP_IMG('2025/12/travel-planner-thailande-voyage-sur-mesure-chiangmai-edited.jpeg')}" alt="Travel Planner en Thaïlande — Chiang Mai, voyage sur-mesure" class="blog-img" />

      <h3>Choisir les bonnes régions</h3>
      <p>Nord, centre, sud, îles… chaque région offre une expérience très différente. Ton choix peut dépendre :</p>
      <ul>
        <li>de la saison (pluies, brûlis, chaleur)</li>
        <li>de ton budget</li>
        <li>de ton style de voyage (plage, culture, nature, aventure)</li>
      </ul>
      <p>Un mauvais choix de régions peut transformer un beau voyage en parcours fatiguant ou décevant.</p>

      <h3>Organiser les transports</h3>
      <p>Vols intérieurs, trains, bus, ferries, taxis… Les options sont nombreuses, mais pas toujours simples à combiner lorsqu'on ne connaît pas la réalité du terrain. Il faut notamment :</p>
      <ul>
        <li>anticiper les temps de trajet</li>
        <li>comprendre les correspondances et où aller les chercher</li>
        <li>éviter certains déplacements inutiles qui te font perdre du temps</li>
      </ul>

      <h3>Réserver les hébergements</h3>
      <p>La Thaïlande offre une large gamme d'hébergements, mais le choix dépend fortement :</p>
      <ul>
        <li>de l'emplacement / région</li>
        <li>de la saison</li>
        <li>du budget</li>
        <li>du type de séjour recherché</li>
      </ul>
      <p>Un hôtel mal situé peut complètement gâcher l'expérience et faire perdre beaucoup de temps et d'argent dans les transports.</p>

      <h3>Planifier les activités sans surcharger</h3>
      <p>Temples, excursions, îles, parcs nationaux, plage, marchés locaux… L'erreur est souvent de vouloir tout faire en même temps. Un bon voyage, ce n'est pas une checklist, c'est un équilibre entre découvertes et moments libres, de détente. Qui a envie de rentrer de vacances encore plus fatigué qu'au départ ?</p>

      <h2>Les erreurs fréquentes à éviter en Thaïlande</h2>
      <p>Beaucoup de voyageurs font les mêmes erreurs :</p>
      <ul>
        <li>vouloir voir trop de choses en trop peu de temps</li>
        <li>sous-estimer les distances</li>
        <li>mal choisir la période du voyage ou la région</li>
        <li>réserver sans comprendre les réalités locales</li>
      </ul>
      <p>Ces erreurs ne sont pas graves, mais elles peuvent coûter cher en temps, en énergie et en argent. Je ne sais pas vous, mais pour moi les vacances riment plus avec détente et découverte qu'avec stress et charge mentale.</p>
      <p>J'en parle d'ailleurs en détail dans cet article, ainsi que comment les éviter : <a href="/blog/erreurs-a-eviter-thailande">Voyage en Thaïlande : les erreurs à éviter absolument →</a></p>

      <img src="${WP_IMG('2025/12/travel-planner-thailande-voyage-sur-mesure-koh-tao.jpg-edited.jpeg')}" alt="Travel Planner en Thaïlande — Koh Tao, voyage sur mesure" class="blog-img" />

      <h2>Peut-on organiser seul, sans être seul ?</h2>
      <p>Organiser son voyage sans agence ne signifie pas forcément être livré à soi-même. De plus en plus de voyageurs choisissent une alternative : se faire accompagner par un·e Travel Planner.</p>
      <p>L'avantage ? Un accompagnement humain et expérimenté, un itinéraire sur-mesure et optimisé, et tout ça en gardant la liberté de réserver où on veut, quand on veut et ce que l'on veut.</p>
      <p>Concrètement, je te propose :</p>
      <ul>
        <li>un itinéraire sur mesure (selon tes besoins et ton budget)</li>
        <li>un carnet de voyage personnalisé</li>
        <li>des recommandations et conseils locaux, adaptés à ton profil</li>
        <li>un accompagnement complet avant et pendant ton voyage</li>
      </ul>
      <p>Tu restes libre de tes choix, mais tu diminues ta charge mentale et évites les erreurs classiques.</p>

      <h2>Organiser oui, mais bien accompagné !</h2>
      <p>Organiser un voyage en Thaïlande sans agence est tout à fait possible, à condition d'avoir les bonnes informations et une vision réaliste du pays. Si tu manques de temps, que tu veux éviter les erreurs ou simplement partir l'esprit tranquille, un accompagnement personnalisé peut transformer ton voyage.</p>
      <p>Si tu souhaites un voyage sur mesure en Thaïlande, clair, optimisé et adapté à tes envies, je serai ravie de t'aider. N'hésite pas à me contacter pour plus d'informations ou me parler de ton projet.</p>
    `
  }
};

export default function BlogPost() {
  const { slug } = useParams();
  const post = BLOG_CONTENT[slug];

  if (!post) {
    return (
      <div className="page">
        <div className="page-hero page-hero-teal">
          <h1>Article non trouvé</h1>
          <p>Cet article n'existe pas ou a été déplacé.</p>
        </div>
        <section className="page-section" style={{textAlign: 'center'}}>
          <Link to="/blog" className="btn-primary">Retour au blog</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-hero page-hero-teal">
        <span style={{
          display: 'inline-block',
          padding: '4px 14px',
          background: 'rgba(255,255,255,0.15)',
          borderRadius: '50px',
          fontSize: '0.8rem',
          fontWeight: '600',
          color: 'rgba(255,255,255,0.9)',
          marginBottom: '16px'
        }}>{post.category}</span>
        <h1>{post.title}</h1>
        <p style={{opacity: 0.8, fontSize: '0.9rem', marginTop: '12px'}}>
          Par Anaïs Zwald — Travel Planner en Thaïlande &nbsp;·&nbsp; {post.date}
        </p>
      </div>

      <section className="page-section">
        <div className="container">
          <div className="prose-wide blog-article" dangerouslySetInnerHTML={{ __html: post.content }} />
        </div>
      </section>

      <section className="page-section bg-cream" style={{textAlign: 'center'}}>
        <div className="container">
          <h2>Envie d'organiser ton voyage ?</h2>
          <div className="prose" style={{textAlign: 'center'}}>
            <p>Je t'accompagne dans la création de ton itinéraire sur mesure en Thaïlande.</p>
          </div>
          <div style={{display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '24px'}}>
            <Link to="/contact#formulaire" className="btn-primary">Me contacter</Link>
            <Link to="/blog" className="btn-secondary">Voir tous les articles</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
