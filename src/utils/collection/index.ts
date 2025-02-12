import {
    addToCollection,
    moveToCollection,
    removeFromCollection,
    restoreToCollection,
    updateCollectionMagicMetadata,
} from 'services/collectionService';
import { downloadFiles, getSelectedFiles } from 'utils/file';
import { getLocalFiles } from 'services/fileService';
import { EnteFile } from 'types/file';
import { CustomError, ServerErrorCodes } from 'utils/error';
import { SelectedState } from 'types/gallery';
import { User } from 'types/user';
import { getData, LS_KEYS } from 'utils/storage/localStorage';
import { SetDialogMessage } from 'components/MessageDialog';
import { logError } from 'utils/sentry';
import constants from 'utils/strings/constants';
import { Collection, CollectionMagicMetadataProps } from 'types/collection';
import { CollectionType } from 'constants/collection';
import { getAlbumSiteHost } from 'constants/pages';
import { getUnixTimeInMicroSecondsWithDelta } from 'utils/time';
import {
    NEW_COLLECTION_MAGIC_METADATA,
    VISIBILITY_STATE,
} from 'types/magicMetadata';
import { IsArchived, updateMagicMetadataProps } from 'utils/magicMetadata';

export enum COLLECTION_OPS_TYPE {
    ADD,
    MOVE,
    REMOVE,
    RESTORE,
}
export async function handleCollectionOps(
    type: COLLECTION_OPS_TYPE,
    setCollectionSelectorView: (value: boolean) => void,
    selected: SelectedState,
    files: EnteFile[],
    setActiveCollection: (id: number) => void,
    collection: Collection
) {
    setCollectionSelectorView(false);
    const selectedFiles = getSelectedFiles(selected, files);
    switch (type) {
        case COLLECTION_OPS_TYPE.ADD:
            await addToCollection(collection, selectedFiles);
            break;
        case COLLECTION_OPS_TYPE.MOVE:
            await moveToCollection(
                selected.collectionID,
                collection,
                selectedFiles
            );
            break;
        case COLLECTION_OPS_TYPE.REMOVE:
            await removeFromCollection(collection, selectedFiles);
            break;
        case COLLECTION_OPS_TYPE.RESTORE:
            await restoreToCollection(collection, selectedFiles);
            break;
        default:
            throw Error(CustomError.INVALID_COLLECTION_OPERATION);
    }
    setActiveCollection(collection.id);
}

export function getSelectedCollection(
    collectionID: number,
    collections: Collection[]
) {
    return collections.find((collection) => collection.id === collectionID);
}

export function isSharedCollection(
    collectionID: number,
    collections: Collection[]
) {
    const user: User = getData(LS_KEYS.USER);

    const collection = getSelectedCollection(collectionID, collections);
    if (!collection) {
        return false;
    }
    return collection?.owner.id !== user.id;
}

export function isFavoriteCollection(
    collectionID: number,
    collections: Collection[]
) {
    const collection = getSelectedCollection(collectionID, collections);
    if (!collection) {
        return false;
    } else {
        return collection.type === CollectionType.favorites;
    }
}

export async function downloadCollection(
    collectionID: number,
    setDialogMessage: SetDialogMessage
) {
    try {
        const allFiles = await getLocalFiles();
        const collectionFiles = allFiles.filter(
            (file) => file.collectionID === collectionID
        );
        await downloadFiles(collectionFiles);
    } catch (e) {
        logError(e, 'download collection failed ');
        setDialogMessage({
            title: constants.ERROR,
            content: constants.DELETE_COLLECTION_FAILED,
            close: { variant: 'danger' },
        });
    }
}

export async function appendCollectionKeyToShareURL(
    url: string,
    collectionKey: string
) {
    if (!url) {
        return null;
    }
    const bs58 = require('bs58');
    const sharableURL = new URL(url);
    if (process.env.NODE_ENV === 'development') {
        sharableURL.host = getAlbumSiteHost();
        sharableURL.protocol = 'http';
    }
    const bytes = Buffer.from(collectionKey, 'base64');
    sharableURL.hash = bs58.encode(bytes);
    return sharableURL.href;
}

const _intSelectOption = (i: number) => {
    return { label: i.toString(), value: i };
};

export function selectIntOptions(upperLimit: number) {
    return [...Array(upperLimit).reverse().keys()].map((i) =>
        _intSelectOption(i + 1)
    );
}

export const shareExpiryOptions = [
    { label: 'never', value: () => 0 },
    {
        label: 'after 1 hour',
        value: () => getUnixTimeInMicroSecondsWithDelta({ hours: 1 }),
    },
    {
        label: 'after 1 day',
        value: () => getUnixTimeInMicroSecondsWithDelta({ days: 1 }),
    },
    {
        label: 'after 1 week',
        value: () => getUnixTimeInMicroSecondsWithDelta({ days: 7 }),
    },
    {
        label: 'after 1 month',
        value: () => getUnixTimeInMicroSecondsWithDelta({ months: 1 }),
    },
    {
        label: 'after 1 year',
        value: () => getUnixTimeInMicroSecondsWithDelta({ years: 1 }),
    },
];

export const changeCollectionVisibilityHelper = async (
    collection: Collection,
    startLoading: () => void,
    finishLoading: () => void,
    setDialogMessage: SetDialogMessage,
    syncWithRemote: () => Promise<void>
) => {
    startLoading();
    try {
        const updatedMagicMetadataProps: CollectionMagicMetadataProps = {
            visibility: collection.magicMetadata?.data.visibility
                ? VISIBILITY_STATE.VISIBLE
                : VISIBILITY_STATE.ARCHIVED,
        };

        const updatedCollection = {
            ...collection,
            magicMetadata: await updateMagicMetadataProps(
                collection.magicMetadata ?? NEW_COLLECTION_MAGIC_METADATA,
                collection.key,
                updatedMagicMetadataProps
            ),
        } as Collection;

        await updateCollectionMagicMetadata(updatedCollection);
    } catch (e) {
        logError(e, 'change file visibility failed');
        switch (e.status?.toString()) {
            case ServerErrorCodes.FORBIDDEN:
                setDialogMessage({
                    title: constants.ERROR,
                    staticBackdrop: true,
                    close: { variant: 'danger' },
                    content: constants.NOT_FILE_OWNER,
                });
                return;
        }
        setDialogMessage({
            title: constants.ERROR,
            staticBackdrop: true,
            close: { variant: 'danger' },
            content: constants.UNKNOWN_ERROR,
        });
    } finally {
        await syncWithRemote();
        finishLoading();
    }
};

export const getArchivedCollections = (collections: Collection[]) => {
    return collections.filter(IsArchived).map((collection) => collection.id);
};
