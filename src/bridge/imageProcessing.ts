import sharp from 'sharp';
import { bridgeLogger } from '../utils/logger.js';

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp' | 'avif';
  stripMetadata?: boolean;
}

/**
 * Image metadata
 */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  isAnimated: boolean;
  size: number;
  orientation?: number;
}

/**
 * Thumbnail options
 */
export interface ThumbnailOptions {
  width: number;
  height: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
}

/**
 * Blurhash component counts (4x3 is standard for Mastodon)
 */
const BLURHASH_X_COMPONENTS = 4;
const BLURHASH_Y_COMPONENTS = 3;

/**
 * Base83 character set for blurhash encoding
 */
const BLURHASH_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

/**
 * Image processor using Sharp
 */
export class ImageProcessor {
  private logger = bridgeLogger();

  /**
   * Extract metadata from image buffer
   */
  async getMetadata(buffer: Buffer): Promise<ImageMetadata> {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    const result: ImageMetadata = {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? 'unknown',
      hasAlpha: metadata.hasAlpha ?? false,
      isAnimated: (metadata.pages ?? 1) > 1,
      size: buffer.length,
    };
    if (metadata.orientation !== undefined) {
      result.orientation = metadata.orientation;
    }
    return result;
  }

  /**
   * Resize image
   */
  async resize(
    buffer: Buffer,
    options: ImageProcessingOptions
  ): Promise<Buffer> {
    let image = sharp(buffer);

    // Auto-rotate based on EXIF orientation
    image = image.rotate();

    if (options.maxWidth !== undefined || options.maxHeight !== undefined) {
      image = image.resize(options.maxWidth, options.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    if (options.stripMetadata === true) {
      image = image.withMetadata({ orientation: undefined });
    }

    // Apply format and quality
    switch (options.format) {
      case 'jpeg':
        image = image.jpeg({ quality: options.quality ?? 85 });
        break;
      case 'png':
        image = image.png({ quality: options.quality ?? 85 });
        break;
      case 'webp':
        image = image.webp({ quality: options.quality ?? 85 });
        break;
      case 'avif':
        image = image.avif({ quality: options.quality ?? 80 });
        break;
    }

    return image.toBuffer();
  }

  /**
   * Generate thumbnail
   */
  async generateThumbnail(
    buffer: Buffer,
    options: ThumbnailOptions
  ): Promise<Buffer> {
    let image = sharp(buffer);

    // Auto-rotate
    image = image.rotate();

    // Resize
    image = image.resize(options.width, options.height, {
      fit: options.fit ?? 'inside',
      withoutEnlargement: true,
    });

    // Apply format
    switch (options.format ?? 'jpeg') {
      case 'jpeg':
        image = image.jpeg({ quality: options.quality ?? 80 });
        break;
      case 'png':
        image = image.png({ quality: options.quality ?? 80 });
        break;
      case 'webp':
        image = image.webp({ quality: options.quality ?? 80 });
        break;
    }

    return image.toBuffer();
  }

  /**
   * Convert image to WebP format
   */
  async convertToWebP(buffer: Buffer, quality: number = 85): Promise<Buffer> {
    return sharp(buffer).rotate().webp({ quality }).toBuffer();
  }

  /**
   * Convert image to JPEG format
   */
  async convertToJpeg(buffer: Buffer, quality: number = 85): Promise<Buffer> {
    return sharp(buffer).rotate().jpeg({ quality }).toBuffer();
  }

  /**
   * Convert image to PNG format
   */
  async convertToPng(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).rotate().png().toBuffer();
  }

  /**
   * Generate blurhash for an image
   *
   * Blurhash is a compact representation of an image placeholder.
   * Reference: https://blurha.sh/
   */
  async generateBlurhash(buffer: Buffer): Promise<string> {
    try {
      // Resize to small dimensions for blurhash calculation
      const { data, info } = await sharp(buffer)
        .rotate()
        .resize(32, 32, { fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = info.width;
      const height = info.height;
      const pixels = new Uint8ClampedArray(data);

      return this.encodeBlurhash(pixels, width, height);
    } catch (error) {
      this.logger.warn('Failed to generate blurhash', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return a fallback blurhash
      return 'L00000fQfQfQfQfQfQfQfQfQfQfQ';
    }
  }

  /**
   * Encode pixel data to blurhash string
   */
  private encodeBlurhash(
    pixels: Uint8ClampedArray,
    width: number,
    height: number
  ): string {
    const components: number[][] = [];

    // Calculate DC and AC components
    for (let j = 0; j < BLURHASH_Y_COMPONENTS; j++) {
      for (let i = 0; i < BLURHASH_X_COMPONENTS; i++) {
        const component = this.calculateComponent(pixels, width, height, i, j);
        components.push(component);
      }
    }

    // Encode DC component
    const dc = components[0];
    if (dc === undefined) {
      return 'L00000fQfQfQfQfQfQfQfQfQfQfQ';
    }
    const dcValue = this.encodeDC(dc);

    // Calculate maximum AC component value
    let maxAC = 0;
    for (let i = 1; i < components.length; i++) {
      const component = components[i];
      if (component !== undefined) {
        for (let j = 0; j < 3; j++) {
          maxAC = Math.max(maxAC, Math.abs(component[j] ?? 0));
        }
      }
    }

    // Quantize maximum AC value
    let quantizedMaxAC = 0;
    if (maxAC > 0) {
      quantizedMaxAC = Math.max(0, Math.min(82, Math.floor(maxAC * 166 - 0.5)));
    }

    // Encode size flag
    const sizeFlag = (BLURHASH_X_COMPONENTS - 1) + (BLURHASH_Y_COMPONENTS - 1) * 9;

    // Build hash string
    let hash = '';
    hash += this.encodeBase83(sizeFlag, 1);
    hash += this.encodeBase83(quantizedMaxAC, 1);
    hash += this.encodeBase83(dcValue, 4);

    // Encode AC components
    const acScale = quantizedMaxAC > 0 ? (quantizedMaxAC + 1) / 166 : 1;
    for (let i = 1; i < components.length; i++) {
      const component = components[i];
      if (component !== undefined) {
        const acValue = this.encodeAC(component, acScale);
        hash += this.encodeBase83(acValue, 2);
      }
    }

    return hash;
  }

  /**
   * Calculate a single component of the blurhash
   */
  private calculateComponent(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    i: number,
    j: number
  ): number[] {
    let r = 0;
    let g = 0;
    let b = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const basis =
          Math.cos((Math.PI * i * x) / width) *
          Math.cos((Math.PI * j * y) / height);

        const pixelIndex = (y * width + x) * 4;
        r += basis * this.sRGBToLinear(pixels[pixelIndex] ?? 0);
        g += basis * this.sRGBToLinear(pixels[pixelIndex + 1] ?? 0);
        b += basis * this.sRGBToLinear(pixels[pixelIndex + 2] ?? 0);
      }
    }

    const scale = 1 / (width * height);
    return [r * scale, g * scale, b * scale];
  }

  /**
   * Encode DC component
   */
  private encodeDC(value: number[]): number {
    const r = this.linearTosRGB(value[0] ?? 0);
    const g = this.linearTosRGB(value[1] ?? 0);
    const b = this.linearTosRGB(value[2] ?? 0);
    return (r << 16) + (g << 8) + b;
  }

  /**
   * Encode AC component
   */
  private encodeAC(value: number[], scale: number): number {
    const quantR = Math.max(
      0,
      Math.min(18, Math.floor(this.signPow((value[0] ?? 0) / scale, 0.5) * 9 + 9.5))
    );
    const quantG = Math.max(
      0,
      Math.min(18, Math.floor(this.signPow((value[1] ?? 0) / scale, 0.5) * 9 + 9.5))
    );
    const quantB = Math.max(
      0,
      Math.min(18, Math.floor(this.signPow((value[2] ?? 0) / scale, 0.5) * 9 + 9.5))
    );
    return quantR * 19 * 19 + quantG * 19 + quantB;
  }

  /**
   * Encode number to base83 string
   */
  private encodeBase83(value: number, length: number): string {
    let result = '';
    for (let i = 1; i <= length; i++) {
      const digit = Math.floor(value / Math.pow(83, length - i)) % 83;
      result += BLURHASH_CHARS[digit];
    }
    return result;
  }

  /**
   * Convert sRGB to linear
   */
  private sRGBToLinear(value: number): number {
    const v = value / 255;
    if (v <= 0.04045) {
      return v / 12.92;
    }
    return Math.pow((v + 0.055) / 1.055, 2.4);
  }

  /**
   * Convert linear to sRGB
   */
  private linearTosRGB(value: number): number {
    const v = Math.max(0, Math.min(1, value));
    if (v <= 0.0031308) {
      return Math.round(v * 12.92 * 255 + 0.5);
    }
    return Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
  }

  /**
   * Sign-preserving power function
   */
  private signPow(value: number, exp: number): number {
    return Math.sign(value) * Math.pow(Math.abs(value), exp);
  }

  /**
   * Strip EXIF and other metadata from image
   */
  async stripMetadata(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).rotate().withMetadata({}).toBuffer();
  }

  /**
   * Check if buffer is a valid image
   */
  async isValidImage(buffer: Buffer): Promise<boolean> {
    try {
      await sharp(buffer).metadata();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get image dimensions
   */
  async getDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    };
  }

  /**
   * Optimize image for web delivery
   */
  async optimizeForWeb(
    buffer: Buffer,
    options?: {
      maxWidth?: number;
      maxHeight?: number;
      quality?: number;
    }
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const metadata = await sharp(buffer).metadata();
    const isAnimated = (metadata.pages ?? 1) > 1;

    // Don't convert animated images (like GIFs)
    if (isAnimated && metadata.format === 'gif') {
      return { buffer, mimeType: 'image/gif' };
    }

    let image = sharp(buffer).rotate();

    // Resize if needed
    if (options?.maxWidth !== undefined || options?.maxHeight !== undefined) {
      image = image.resize(options.maxWidth, options.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Convert to WebP for better compression
    const optimized = await image
      .webp({ quality: options?.quality ?? 85 })
      .toBuffer();

    return { buffer: optimized, mimeType: 'image/webp' };
  }
}

/**
 * Create a shared image processor instance
 */
let sharedProcessor: ImageProcessor | null = null;

export function getImageProcessor(): ImageProcessor {
  if (sharedProcessor === null) {
    sharedProcessor = new ImageProcessor();
  }
  return sharedProcessor;
}
