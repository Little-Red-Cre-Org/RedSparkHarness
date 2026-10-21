/**
 * DeepSeek vision-token accounting: the provider's published image-token
 * calculator (api-docs.deepseek.com, Token & Token Usage) ported verbatim in
 * its current `v41` configuration. The provider scales an image below
 * 544×544 total pixels up, aligns it to a 14px-patch grid, downsamples 3:1
 * per axis into token cells, and caps one image at 1024 tokens by solving the
 * largest aspect-preserving grid inside that budget. The count is exact: this
 * configuration has no alignment pad and no aspect-ratio clamp. Actual usage
 * remains authoritative.
 *
 * @module dsh-llm-deepseek/image-tokens
 */
/**
 * Vision tokens DeepSeek charges for one request image of the given
 * dimensions.
 * @param width - positive integer request-image width in pixels.
 * @param height - positive integer request-image height in pixels.
 * @returns the provider vision-token price, at most 1024.
 */
export declare function deepSeekImageTokens(width: number, height: number): number;
//# sourceMappingURL=image-tokens.d.ts.map