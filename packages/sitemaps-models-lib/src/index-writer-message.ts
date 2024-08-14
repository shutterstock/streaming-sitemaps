import { IndexItem } from 'sitemap';

/**
 * Message structure for the Kinesis sitemap writer stream.
 * Producer: kinesis-sitemap-writer
 * Consumer: kinesis-index-writer
 */
export interface IIndexWriterMessage {
  /**
   * User-defined type - Used in metrics and log messages
   */
  type: string;

  /**
   * Index item data
   */
  indexItem: IndexItem;

  /**
   * add or update the lastmod on an item
   */
  action: 'add' | 'update';
}
