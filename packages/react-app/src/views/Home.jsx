import {
  Box,
  Text,
  VStack,
  Code,
  Button,
  Image,
  SimpleGrid,
  Flex,
  Badge,
  Divider,
  InputGroup,
  Input,
  Avatar,
  InputRightElement,
  Spinner,
  Link,
  useToast
} from '@chakra-ui/react'
import { useEffect, useState, useCallback, FC } from 'react'
import { useMoralis } from 'react-moralis'
// @ts-ignore
import { Web3Storage } from 'web3.storage/dist/bundle.esm.min.js'
import axios from 'axios'
import { ethers } from 'ethers'
import { sortBy } from 'lodash'
import './Home.css'
import Wallet from '../components/Wallet'
const FileType = require('file-type/browser')


const COVALENT_URI = process.env.REACT_APP_COVALENT_BASE_URI || 'https://api.covalenthq.com/v1'
const ERC721Abi = [
  'function ownerOf(uint256 _tokenId) external view returns (address)'
]

const Home = ({ account, chainId }) => {
  const { web3, Moralis, logout } = useMoralis()

  const [assets, setAssets] = useState([])
  const [selectedAsset, setSelectedAsset] = useState()
  const [email, setEmail] = useState('')
  const [isLinking, setIsLinking] = useState(false)
  const [isInvalid, setIsInvalid] = useState(false)
  const [web3Storage, setWeb3Storage] = useState()
  const [isLoading, setIsLoading] = useState(false)
  const [ensName, setEnsName] = useState('')

  const toast = useToast()

  const onRootCidReady = (cid) => {
    console.log('uploading files with cid:', cid)
  }

  const extractNFTInfo = useCallback(async (item) => {
    const token_address = item['contract_address']
    const symbol = item['contract_ticker_symbol']
    const name = item['contract_name']
    const contract_type = item['supports_erc'][1]

    const nftData = item['nft_data']
    for(let i = 0; i < nftData.length; i++) {
      const nft = nftData[i]
      
      let image = nft['external_data']['image']
      let cid
      if (image) {
        cid = image.includes('ipfs://') ? image.split('ipfs://')[1]
          : image.includes('ipfs/') ? image.split('ipfs/')[1] : ''
        
        if (!cid) {
          const response = await fetch(image)
          let blob = await response.blob()
          let file = new File([blob], 'avatar.png', { type: response.headers.get('content-type') || '' })
          const rootCid = await web3Storage?.put([file], { onRootCidReady })
          if (rootCid) {
            const res = await web3Storage?.get(rootCid)
            if (!res?.ok) {
              throw new Error(`failed to get ${rootCid} - [${res?.status}] ${res?.statusText}`)
            }
            const files = await res.files()
            cid = files.length > 0 ? files[0].cid : ''
            image = `https://ipfs.io/ipfs/${cid}`
          }
        }
      }

      const asset = {
        token_address,
        token_id: nft['token_id'],
        contract_type,
        symbol,
        name,
        metadata: JSON.stringify({
          name: nft['external_data']['name'],
          description: nft['external_data']['description'],
          token_url: nft['token_url'],
          cid: cid,
          image
        })
      }
      setAssets((assets) => [...assets, asset])
    }
  }, [web3Storage])

  const getNFTs = useCallback(async () => {
    if (!web3Storage || !chainId || !account) return
    const { data } = await axios.get(`${COVALENT_URI}/${Number(chainId)}/address/${account}/balances_v2/?format=JSON&nft=true`, {
      responseType: 'json',
      auth: {
        username: process.env.REACT_APP_COVALENT_API_KEY || '',
        password: ''
      },
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })

    if (data.error) {
      console.error('Error to fetch NFTs, error code:', data.error_code, 'error message:', data.error_message)
      return []
    }

    setAssets([])
    data.data.items
      .filter((item) => item.type === 'nft' && item['nft_data'] && item['nft_data'].length > 0)
      .forEach(async (item) => {
        await extractNFTInfo(item)
      })
    setIsLoading(false)
  }, [account, chainId, extractNFTInfo, web3Storage])
  
  const hashedMessage = (str) => {
    return ethers.utils.id(str)
  }

  const isPrimaryAvatar = (asset) => {
    const item = localStorage.getItem(`avatar-${account.toLowerCase()}`)
    const toBeVerified = hashedMessage(`${asset.token_address}${asset.token_id}`)
    return item === toBeVerified
  }

  const saveAvatarLinkData = async (data) => {
    try {
      let myAvatar = await getAvatarInfoByWalletAddress()
      if (!myAvatar) {
        const MyAvatar = Moralis.Object.extend('MyAvatar')
        myAvatar = new MyAvatar()
      }
      await myAvatar?.save(data)
    } catch (error) {
      // Execute any logic that should take place if the save fails.
      // error is a Moralis.Error with an error code and message.
      console.error('Failed to create new object, with error code:', error.message)
    }
  }

  const getAvatarInfoByWalletAddress = async () => {
    const MyAvatar = Moralis.Object.extend('MyAvatar')
    const query = new Moralis.Query(MyAvatar)
    const address = account.toLowerCase()
    query.equalTo('address', address)
    return await query.first()
  }

  const ownerVerification = async (asset) => {
    const provider = new ethers.providers.Web3Provider(web3?.givenProvider)
    const signer = provider.getSigner()

    let ensEmail
    if (ensName && Number(chainId) === 1) {
      const resolver = await provider.getResolver(ensName)
      ensEmail = await resolver.getText('email')
    }

    const message = 'Please sign this message to verify you are the owner of the selected NFT'
    const signature = await signer.signMessage(message)
    const sigBreakdown = ethers.utils.splitSignature(signature)
    const recoveredAddress = ethers.utils.verifyMessage(message, sigBreakdown)
    if (asset.token_address && asset.token_id) {
      const contract = new ethers.Contract(asset.token_address, ERC721Abi, provider)
      const owner = await contract.ownerOf(Number(asset.token_id))
      if (recoveredAddress.toLowerCase() === owner.toLowerCase()) {
        localStorage.setItem(`avatar-${owner.toLowerCase()}`, hashedMessage(`${asset.token_address}${asset.token_id}`))
        const metadata = JSON.parse(asset.metadata)
        const avatar = `${process.env.REACT_APP_IMG8_API_URI}/${metadata.cid}?t=avatar&w=48`
        saveAvatarLinkData({
          address: owner.toLowerCase(),
          tokenAddress: asset.token_address,
          tokenId: asset.token_id,
          avatar: metadata.cid,
          email: ensEmail
        })
        setSelectedAsset({ ...asset, avatar })
        toast({
          description: 'Your avatar setup is succeeded',
          status: 'success',
          variant: 'left-accent',
          position: 'top-right',
          isClosable: true,
        })
      } else {
        console.error('you are not the owner of the NFT')
      }
    }
  }

  const emailIsValid = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  const handleEmailChange = (e) => {
    setEmail(e.target.value)
    if(!emailIsValid(email)) {
      setIsInvalid(true)
      return
    }
    setIsInvalid(false)
  }

  const handleLinkEmail = async () => {
    setIsLinking(true)

    const provider = new ethers.providers.Web3Provider(web3?.givenProvider)
    const signer = provider.getSigner()

    try {
      const hashedEmail = ethers.utils.id(email)
      const message = `Are you sure you wanted to link ${email} with this wallet? \n${hashedEmail}`
      const signature = await signer.signMessage(message)
      const sigBreakdown = ethers.utils.splitSignature(signature)
      const recoveredAddress = ethers.utils.verifyMessage(message, sigBreakdown)

      if (recoveredAddress.toLowerCase() === account) {
        const myAvatar = await getAvatarInfoByWalletAddress()
        myAvatar?.set('email', hashedEmail)
        await myAvatar?.save()
        setEmail('')
        toast({
          description: 'Your email is linked',
          status: 'success',
          variant: 'left-accent',
          position: 'top-right',
          isClosable: true,
        })
      }
    } catch (err) {
      console.error('handle link email error:', err.message || err)
    } finally {
      setIsLinking(false)
    }
  }

  const checkEnsName = useCallback(async () => {
    const provider = new ethers.providers.Web3Provider(web3?.givenProvider)
    
    if (Number(chainId) === 1) {
      const ensName = await provider.lookupAddress(account)
      setEnsName(ensName)
    }
  }, [account, chainId, web3?.givenProvider])

  useEffect(() => {
    setIsLoading(true)
    if (!web3Storage) {
      setWeb3Storage(new Web3Storage({ token: process.env.REACT_APP_WEB3_STORAGE_API_KEY || '' }))
    }

    checkEnsName()

    getNFTs()
    
    // fetchNFTsByUsingMoralis()
  }, [checkEnsName, getNFTs, web3Storage])

  

  const init = useCallback(async () => {
    const MyAvatar = Moralis.Object.extend('MyAvatar')
    const query = new Moralis.Query(MyAvatar)
    const address = account.toLowerCase()
    query.equalTo('address', address)
    const myAvatar =  await query.first()
    setSelectedAsset(myAvatar?.attributes)
  }, [Moralis.Object, Moralis.Query, account])

  useEffect(() => {
    init()
  }, [init])

  return (
    <Box>
      <Box mb={5}>
        <VStack>
          <Wallet selectedAsset={selectedAsset} ensName={ensName} account={account} logout={logout} />
        </VStack>
      </Box>

      <Divider />

      {
        selectedAsset ? (
          <>
            <Box my={5}>
              <VStack>
                <InputGroup size="md" maxW={'sm'}>
                  <Input
                    value={email}
                    type="email"
                    required
                    isInvalid={isInvalid}
                    errorBorderColor="crimson"
                    placeholder="Link your email"
                    onChange={(e) => handleEmailChange(e)}
                  />
                  <InputRightElement width="auto">
                    <Button
                      colorScheme={'teal'}
                      w={20}
                      onClick={() => handleLinkEmail()}
                      disabled={!email || isInvalid}
                      isLoading={isLinking}
                      borderLeftRadius={'none'}
                    >
                      Link
                    </Button>
                  </InputRightElement>
                </InputGroup>
                <Text color={'gray'} fontSize="xs">
                  * Link your email to use the verified NFT as an avatar in supported web2 applications
                </Text>
              </VStack>
              
            </Box>
            <Divider />
          </>
        ) : ''
      }
      
      {
        isLoading ? (
          <Box as={Flex} justifyContent={'center'} alignItems={'center'} h={300}>
            <Spinner
              thickness="4px"
              speed="0.65s"
              emptyColor="gray.200"
              color="blue.500"
              size="xl"
            />
          </Box>
        ) : (
          <SimpleGrid minChildWidth="15rem" spacing={3} mt={5}>
            {
              assets.length === 0 ? 'No data found' :
              assets.map((asset, idx) => {
                const metadata = JSON.parse(asset.metadata)
                const image = metadata?.image.startsWith('ipfs://')
                  ? `https://ipfs.io/ipfs/${metadata?.image?.split('ipfs://')[1]}` : metadata?.image

                return (
                  <Box
                    cursor="pointer"
                    key={idx}
                    borderWidth="1px"
                    maxW={'sm'}
                    borderRadius="lg"
                    _hover={{ boxShadow: '0 10px 16px 0 rgb(0 0 0 / 20%), 0 6px 20px 0 rgb(0 0 0 / 19%)' }}
                    onClick={() => ownerVerification(asset)}
                    style={{ boxShadow: isPrimaryAvatar(asset) ? '0 10px 16px 0 rgb(0 0 0 / 20%), 0 6px 20px 0 rgb(0 0 0 / 19%)' : '' }}
                  >
                    <Box w={'100%'} height={250} alignItems={'center'} justifyContent={'center'}>
                      <Box as={Flex} alignItems={'center'} justifyContent={'center'} py={2}>
                        {
                          asset?.mime?.startsWith('video') ? (
                            <video width="90%" src={image} autoPlay loop muted data-loaded="loaded" style={{'borderRadius': '0.5rem', 'maxHeight': '250px'}}></video>
                          ) : <Image maxW={'90%'} maxH={250} lineHeight={250} src={image} alt={asset.name} borderRadius="lg" />
                        }
                      </Box>
                    </Box>
                    <Box px="3">
                      <Box display="flex" alignItems="baseline">
                        <Badge borderRadius="full" px="2" colorScheme="teal">
                          {asset.contract_type}
                        </Badge>
                        <Box
                          color="gray.500"
                          fontWeight="semibold"
                          letterSpacing="wide"
                          fontSize="xs"
                          textTransform="uppercase"
                          ml="2"
                          isTruncated
                          title={`${asset.name} ∙ ${asset.symbol}`}
                        >
                          {asset.name} &bull; {asset.symbol}
                        </Box>
                      </Box>

                      <Box
                        mt="1"
                        fontWeight="semibold"
                        lineHeight="tight"
                        isTruncated
                        title={metadata?.name}
                        mb={3}
                      >
                        {metadata?.name}
                      </Box>

                    </Box>
                  </Box>
                )
              })
            }
          </SimpleGrid>
        )
      }
      
    </Box>
  )
}

export default Home
