import { type ApiQueryOptions, type CacheEntry, MetadataApiProvider, ReleaseApiLookup } from '@/providers/base.ts';
import { DurationPrecision, FeatureQuality, type FeatureQualityMap } from '@/providers/features.ts';
import type { ProviderCategory } from '@/providers/categories.ts';
import type { PartialDate } from '@/utils/date.ts';
import { ProviderError } from '@/utils/errors.ts';
import type {
	ArtistCreditName,
	Artwork,
	EntityId,
	HarmonyMedium,
	HarmonyRelease,
	HarmonyTrack,
	Label,
	LinkType,
	ReleaseGroupType,
} from '@/harmonizer/types.ts';
import type {
	MelonAlbumInfo,
	MelonAlbumInfoResponse,
	MelonArtist,
	MelonDisc,
	MelonSong,
	MelonSongListResponse,
} from './api_types.ts';

const API_BASE = 'https://m2.melon.com/m6';

export default class MelonProvider extends MetadataApiProvider {
	readonly name = 'Melon';

	readonly supportedUrls = new URLPattern({
		hostname: 'www.melon.com',
		pathname: String.raw`/:type(album|song|artist)/detail.htm\?\1Id=:id(\d+)`,
	});

	override readonly categories = new Set<ProviderCategory>(['digital']);

	override readonly features: FeatureQualityMap = {
		'cover size': 2000,
		'duration precision': DurationPrecision.SECONDS,
		'GTIN lookup': FeatureQuality.MISSING,
		'MBID resolving': FeatureQuality.PRESENT,
		'release label': FeatureQuality.PRESENT,
	};

	readonly entityTypeMap = {
		artist: 'artist',
		release: 'album',
		recording: 'song',
	};

	override readonly availableRegions = new Set(['KR']);

	readonly releaseLookup = MelonReleaseLookup;

	override readonly launchDate: PartialDate = {
		year: 2004,
		month: 11,
	};

	override extractEntityFromUrl(url: URL): EntityId | undefined {
		if (!this.supportsDomain(url)) return undefined;

		const albumId = url.searchParams.get('albumId');
		if (albumId && url.pathname.startsWith('/album/')) {
			return { type: 'album', id: albumId };
		}

		const artistId = url.searchParams.get('artistId');
		if (artistId && url.pathname.startsWith('/artist/')) {
			return { type: 'artist', id: artistId };
		}

		const songId = url.searchParams.get('songId');
		if (songId && url.pathname.startsWith('/song/')) {
			return { type: 'song', id: songId };
		}
	}

	constructUrl(entity: EntityId): URL {
		return new URL(`https://www.melon.com/${entity.type}/detail.htm?${entity.type}Id=${entity.id}`);
	}

	override getLinkTypesForEntity(): LinkType[] {
		return ['paid streaming', 'paid download'];
	}

	query<Data>(apiUrl: URL, options?: ApiQueryOptions): Promise<CacheEntry<Data>> {
		return this.fetchJSON<Data>(apiUrl, {
			policy: { maxTimestamp: options?.snapshotMaxTimestamp },
		});
	}
}

export class MelonReleaseLookup extends ReleaseApiLookup<MelonProvider, MelonRawRelease> {
	constructReleaseApiUrl(): URL {
		const url = new URL(`${API_BASE}/v3/album/info.json`);
		url.searchParams.set('albumId', this.lookup.value);
		return url;
	}

	protected async getRawRelease(): Promise<MelonRawRelease> {
		if (this.lookup.method === 'gtin') {
			throw new ProviderError(this.provider.name, 'GTIN lookups are not supported');
		}

		const albumId = this.lookup.value;

		const infoUrl = this.constructReleaseApiUrl();
		const songListUrl = new URL(`${API_BASE}/v2/album/song/list.json`);
		songListUrl.searchParams.set('albumId', albumId);

		const snapshotMaxTimestamp = this.options.snapshotMaxTimestamp;
		const [infoEntry, songListEntry] = await Promise.all([
			this.provider.query<MelonAlbumInfoResponse>(infoUrl, { snapshotMaxTimestamp }),
			this.provider.query<MelonSongListResponse>(songListUrl, { snapshotMaxTimestamp }),
		]);

		this.updateCacheTime(infoEntry.timestamp);
		this.updateCacheTime(songListEntry.timestamp);

		const albumInfo = infoEntry.content.response.ALBUMINFO;
		const albumType = infoEntry.content.response.ALBUMTYPE;
		const planCnpy = infoEntry.content.response.PLANCNPY;
		const cdList = songListEntry.content.response.CDLIST;

		return {
			albumInfo,
			albumType,
			planCnpy,
			cdList,
		};
	}

	protected convertRawRelease(raw: MelonRawRelease): HarmonyRelease {
		this.entity = { type: 'album', id: raw.albumInfo.ALBUMID };

		return {
			title: raw.albumInfo.ALBUMNAME,
			artists: raw.albumInfo.ARTISTLIST.map((a) => this.convertRawArtist(a)),
			releaseDate: this.convertReleaseDate(parseISSUEDATE(raw.albumInfo.ISSUEDATE)),
			labels: this.extractLabels(raw.planCnpy),
			images: [this.coverArtwork(raw.albumInfo.ALBUMIMGLARGE)],
			types: mapReleaseType(raw.albumType),
			availableIn: ['KR'],
			status: 'Official',
			packaging: 'None',
			media: this.buildMedia(raw.cdList),
			// TODO: check if we can check for download availability
			externalLinks: raw.albumInfo.ISSERVICE
				? [{ url: this.provider.constructUrl(this.entity).toString(), types: ['paid streaming'] }]
				: [],
			info: this.generateReleaseInfo(),
		};
	}

	private convertRawArtist(artist: MelonArtist): ArtistCreditName {
		return {
			name: artist.ARTISTNAME,
			creditedName: artist.ARTISTNAME,
			externalIds: this.provider.makeExternalIds({ type: 'artist', id: artist.ARTISTID }),
		};
	}

	private extractLabels(planCnpy?: string): Label[] {
		if (!planCnpy) return [];
		return planCnpy.split(', ').map((name) => ({ name: name.trim() }));
	}

	private coverArtwork(largeUrl: string): Artwork {
		const originalUrl = largeUrl.replace(
			/(images\/.*\/[^/_]*)((_[^/.]*)_)?(_?[^/._]*)?(\.[^/.?]*)(?:[?/].*)?$/,
			'$1$3_org$5',
		);
		return {
			url: originalUrl,
			thumbUrl: largeUrl,
			types: ['front'],
		};
	}

	private buildMedia(cdList: MelonDisc[]): HarmonyMedium[] {
		return cdList.map((disc) => ({
			number: parseInt(disc.CDNO),
			format: 'Digital Media',
			tracklist: disc.SONGLIST
				.filter((song) => song.ISSERVICE)
				.map((song) => this.convertRawTrack(song)),
		}));
	}

	private convertRawTrack(song: MelonSong): HarmonyTrack {
		return {
			title: song.SONGNAME,
			artists: song.ARTISTLIST.map((a) => this.convertRawArtist(a)),
			number: parseInt(song.TRACKNO),
			length: parseInt(song.PLAYTIME) * 1000,
			recording: {
				externalIds: this.provider.makeExternalIds({ type: 'song', id: song.SONGID }),
			},
		};
	}
}

interface MelonRawRelease {
	albumInfo: MelonAlbumInfo;
	albumType?: string;
	planCnpy?: string;
	cdList: MelonDisc[];
}

function parseISSUEDATE(date: string): PartialDate {
	const match = date.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
	if (!match) return {};
	return {
		year: parseInt(match[1]),
		month: parseInt(match[2]),
		day: parseInt(match[3]),
	};
}

function mapReleaseType(albumType?: string): ReleaseGroupType[] | undefined {
	if (!albumType) return undefined;
	if (albumType === '싱글') return ['Single'];
	if (albumType === '정규') return ['Album'];
	if (albumType === 'EP') return ['EP'];
	if (albumType === '옴니버스') return ['Compilation'];
	if (albumType === 'OST') return ['Soundtrack'];
	if (albumType === '리믹스') return ['Single', 'Remix'];
	return undefined;
}
