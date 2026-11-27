import type { Language } from '../preferences';
import type { VisibleImportStage } from './catalogImportProgress.mts';

type ImportLabels = {
  title: string;
  total: string;
  step: (position: string, count: string) => string;
  active: string;
  complete: string;
  skipped: string;
  pending: string;
  stages: Record<VisibleImportStage, string>;
};

export const catalogImportLabels: Record<Language, ImportLabels> = {
  en: {
    title: 'Data import', total: 'Estimated overall progress',
    step: (position, count) => `Step ${position} / ${count}`,
    active: 'In progress', complete: 'Done', skipped: 'Skipped', pending: 'Waiting',
    stages: {
      reading: 'Check and read archive', 'ponder-scenes': 'Process Ponder scenes', 'ponder-definitions': 'Import Ponder schematics',
      items: 'Import items and images', 'recipe-index': 'Index recipe uses', publishing: 'Publish data',
    },
  },
  cs: {
    title: 'Import dat', total: 'Odhad celkového průběhu',
    step: (position, count) => `Krok ${position} / ${count}`,
    active: 'Probíhá', complete: 'Hotovo', skipped: 'Přeskočeno', pending: 'Čeká',
    stages: {
      reading: 'Kontrola a načtení archivu', 'ponder-scenes': 'Zpracování scén Ponderu', 'ponder-definitions': 'Import schémat Ponderu',
      items: 'Import katalogu předmětů a obrázků', 'recipe-index': 'Indexování použití v receptech', publishing: 'Zveřejnění dat',
    },
  },
  de: {
    title: 'Datenimport', total: 'Geschätzter Gesamtfortschritt',
    step: (position, count) => `Schritt ${position} / ${count}`,
    active: 'Läuft', complete: 'Fertig', skipped: 'Übersprungen', pending: 'Wartet',
    stages: {
      reading: 'Archiv prüfen und lesen', 'ponder-scenes': 'Ponder-Szenen verarbeiten', 'ponder-definitions': 'Ponder-Baupläne importieren',
      items: 'Gegenstände und Bilder importieren', 'recipe-index': 'Rezeptverwendungen indexieren', publishing: 'Daten veröffentlichen',
    },
  },
  es: {
    title: 'Importación de datos', total: 'Progreso total estimado',
    step: (position, count) => `Paso ${position} / ${count}`,
    active: 'En curso', complete: 'Completado', skipped: 'Omitido', pending: 'En espera',
    stages: {
      reading: 'Comprobar y leer el archivo', 'ponder-scenes': 'Procesar escenas de Ponder', 'ponder-definitions': 'Importar esquemas de Ponder',
      items: 'Importar objetos e imágenes', 'recipe-index': 'Indexar usos en recetas', publishing: 'Publicar datos',
    },
  },
  fr: {
    title: 'Importation des données', total: 'Progression globale estimée',
    step: (position, count) => `Étape ${position} / ${count}`,
    active: 'En cours', complete: 'Terminé', skipped: 'Ignoré', pending: 'En attente',
    stages: {
      reading: 'Vérifier et lire l’archive', 'ponder-scenes': 'Traiter les scènes de Ponder', 'ponder-definitions': 'Importer les plans de Ponder',
      items: 'Importer les objets et les images', 'recipe-index': 'Indexer les usages dans les recettes', publishing: 'Publier les données',
    },
  },
  ja: {
    title: 'データのインポート', total: '全体の進捗（概算）',
    step: (position, count) => `ステップ ${position} / ${count}`,
    active: '処理中', complete: '完了', skipped: 'スキップ', pending: '待機中',
    stages: {
      reading: 'アーカイブの確認と読み込み', 'ponder-scenes': 'Ponderのシーンの処理', 'ponder-definitions': 'Ponderの設計図のインポート',
      items: 'アイテムと画像のインポート', 'recipe-index': 'レシピでの用途の索引作成', publishing: 'データの公開',
    },
  },
  uk: {
    title: 'Імпорт даних', total: 'Орієнтовний загальний прогрес',
    step: (position, count) => `Крок ${position} / ${count}`,
    active: 'Триває', complete: 'Готово', skipped: 'Пропущено', pending: 'Очікує',
    stages: {
      reading: 'Перевірити й прочитати архів', 'ponder-scenes': 'Обробити сцени Ponder', 'ponder-definitions': 'Імпортувати схеми Ponder',
      items: 'Імпортувати предмети й зображення', 'recipe-index': 'Індексувати використання в рецептах', publishing: 'Опублікувати дані',
    },
  },
};
