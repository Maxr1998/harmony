import type { ReleaseOptions } from '@/harmonizer/types.ts';
import { describeProvider, makeProviderOptions } from '@/providers/test_spec.ts';
import { stubProviderLookups } from '@/providers/test_stubs.ts';
import { afterAll, describe } from '@std/testing/bdd';
import { assertSnapshot } from '@std/testing/snapshot';
import { assert, assertEquals } from 'std/assert/mod.ts';

import MelonProvider from './mod.ts';

describe('Melon provider', () => {
	const melon = new MelonProvider(makeProviderOptions());
	const stubs = [stubProviderLookups(melon)];

	const releaseOptions: ReleaseOptions = {
		withISRC: false,
		withAllTrackArtists: true,
	};

	describeProvider(melon, {
		urls: [{
			description: 'album page',
			url: new URL('https://www.melon.com/album/detail.htm?albumId=13693526'),
			id: { type: 'album', id: '13693526' },
			isCanonical: true,
		}, {
			description: 'artist page',
			url: new URL('https://www.melon.com/artist/detail.htm?artistId=1273010'),
			id: { type: 'artist', id: '1273010' },
			isCanonical: true,
		}, {
			description: 'song page',
			url: new URL('https://www.melon.com/song/detail.htm?songId=602111505'),
			id: { type: 'song', id: '602111505' },
			isCanonical: true,
		}, {
			description: 'search page (unsupported)',
			url: new URL('https://www.melon.com/search/total/index.htm?q=test'),
			id: undefined,
		}],
		invalidIds: ['abc', 'not-a-number', '123abc'],
		releaseLookup: [{
			description: 'Regular (정규) album with unavailable CD-only tracks',
			release: new URL('https://www.melon.com/album/detail.htm?albumId=13691104'),
			options: releaseOptions,
			assert: async (release, ctx) => {
				await assertSnapshot(ctx, release);
				assertEquals(release.media.length, 1, 'Should have one disc');
				assertEquals(release.media[0].tracklist.length, 11, 'Should have 11 tracks (without the two CD-only tracks)');
				assert(release.types?.includes('Album'), 'Should be classified as Album');
			},
		}, {
			description: 'Regular (정규) album with multiple discs and multiple artists',
			release: new URL('https://www.melon.com/album/detail.htm?albumId=10000727'),
			options: releaseOptions,
			assert: async (release, ctx) => {
				await assertSnapshot(ctx, release);
				assertEquals(release.media.length, 2, 'Should have two discs');
				assertEquals(release.media[0].tracklist.length, 10, 'Disc 1 should have 10 tracks');
				assertEquals(release.media[1].tracklist.length, 7, 'Disc 2 should have 7 tracks');
				assert(release.types?.includes('Album'), 'Should be classified as Album');
				const lastTrack = release.media[1].tracklist.at(-1)!;
				assertEquals(
					lastTrack.artists?.map((a) => a.name),
					['웨이 (크레용팝)', '초아 (크레용팝)'],
					'Track with multiple artists should have correct artists',
				);
			},
		}, {
			description: 'EP (미니) album',
			release: new URL('https://www.melon.com/album/detail.htm?albumId=13693526'),
			options: releaseOptions,
			assert: async (release, ctx) => {
				await assertSnapshot(ctx, release);
				assertEquals(release.media.length, 1, 'Should have one disc');
				assertEquals(release.media[0].tracklist.length, 7, 'Should have 7 tracks');
				assert(release.types?.includes('EP'), 'Should be classified as EP');
			},
		}, {
			description: 'Single (싱글) album',
			release: new URL('https://www.melon.com/album/detail.htm?albumId=13732020'),
			options: releaseOptions,
			assert: async (release, ctx) => {
				await assertSnapshot(ctx, release);
				assertEquals(release.media.length, 1, 'Should have one disc');
				assertEquals(release.media[0].tracklist.length, 1, 'Should have 1 track');
				assert(release.types?.includes('Single'), 'Should be classified as Single');
			},
		}],
	});

	afterAll(() => {
		stubs.forEach((s) => s.restore());
	});
});
